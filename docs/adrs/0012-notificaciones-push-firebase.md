# ADR 0012: Notificaciones Push con Firebase Cloud Messaging y Firestore

## Estado
Aceptado

## Contexto

Bazaar necesita notificar a los usuarios sobre eventos relevantes de la plataforma en tiempo real: cambios de estado de sus órdenes (confirmada, en preparación, enviada, entregada, cancelada), problemas de pago, y alertas de stock para los vendedores (stock bajo, sin stock).

El canal principal de interacción de los usuarios es la aplicación móvil (React Native con Expo). Las notificaciones deben llegar al dispositivo incluso cuando la app está en background o cerrada, lo que descarta soluciones basadas en WebSockets o Server-Sent Events.

Las restricciones del contexto son:

- La app móvil está construida con **Expo**, que abstrae las APIs nativas de notificaciones de iOS y Android.
- Se necesita un proveedor de push que tenga soporte oficial para Expo o que sea compatible con los estándares nativos (APNs para iOS, FCM para Android).
- El sistema debe soportar múltiples dispositivos por usuario (un usuario puede tener el teléfono y la tablet con sesión abierta).
- Los tokens de dispositivo cambian: cuando el usuario desinstala y reinstala la app, o cuando el sistema operativo rota el token, el token anterior queda inválido.
- El envío de notificaciones desde los microservicios backend debe ser no bloqueante: un fallo en el envío push no debe interrumpir el flujo principal (confirmar una orden, actualizar el stock, etc.).

Las alternativas evaluadas fueron:

- **Firebase Cloud Messaging (FCM)**: servicio de Google para push notifications a Android, iOS y web. Tiene soporte nativo en Expo a través del SDK `expo-notifications` y es compatible con tokens de Expo. Requiere una Service Account key para el envío desde servidor.
- **Expo Push Notifications Service**: servicio gestionado por Expo que actúa como intermediario entre el servidor y FCM/APNs. Simplifica la integración del lado servidor (una sola API en lugar de FCM + APNs), pero introduce dependencia en la infraestructura de Expo y tiene límites de tasa en el plan gratuito.
- **OneSignal**: plataforma de terceros para push notifications con SDK propio. Tiene plan gratuito generoso, dashboard visual y soporte para segmentación de audiencias. Introduce un proveedor adicional con su propia capa de SDK en la app móvil.
- **AWS SNS (Simple Notification Service)**: servicio de Amazon compatible con FCM y APNs. Bien integrado con infraestructura AWS, pero requiere configuración adicional de tópicos, suscripciones y certificados APNs. Mayor overhead operativo para el caso de uso.

Para el almacenamiento de tokens de dispositivo, las opciones evaluadas fueron:

- **PostgreSQL (existente en Supabase)**: una tabla `device_tokens` en la base de datos de user-api. Garantiza consistencia ACID pero acopla la gestión de tokens a la base de datos transaccional de usuarios.
- **MongoDB (existente en Atlas)**: una colección en la base de datos del catalog-api. Sin vínculo lógico con el dominio de catálogo; sería una dependencia arbitraria.
- **Firestore (Google Cloud)**: base de datos NoSQL serverless incluida en el proyecto Firebase. Vive en el mismo proveedor que FCM, sin infraestructura adicional a gestionar. El modelo de datos orientado a documentos encaja naturalmente con tokens: un documento por token, `user_id` como campo de búsqueda.
- **Redis**: adecuado para almacenamiento efímero de alta velocidad, pero requiere levantar y operar una instancia adicional y no tiene persistencia garantizada por defecto.

## Decisión

### Proveedor de push: Firebase Cloud Messaging (FCM)

Se adopta **FCM** como proveedor de notificaciones push, integrado con la app mobile mediante el SDK `expo-notifications`. El vínculo entre Expo y FCM se establece a través del archivo `google-services.json` generado en Firebase Console, que se incluye en la build de la app vía EAS Build.

La autenticación del servidor con FCM se realiza con una **Service Account key** (archivo JSON descargado de Firebase Console). Esta credencial se pasa al contenedor como archivo montado en desarrollo local o como variable de entorno `FIREBASE_CREDENTIALS_JSON` en producción, para evitar copiar el archivo al servidor.

FCM fue elegido sobre las alternativas por las siguientes razones:

- Es el proveedor subyacente que usa Expo internamente. Usar FCM directamente elimina una capa de indirección y evita depender de la infraestructura de Expo para el envío.
- El Firebase Admin SDK para Python tiene soporte oficial de Google, documentación completa y actualizaciones regulares.
- Al estar en el mismo proyecto Firebase que Firestore (el storage de tokens), no agrega un proveedor nuevo al sistema.
- No tiene límites de tasa relevantes para el volumen esperado de la plataforma.

### Almacenamiento de tokens: Firestore

Se adopta **Firestore** como almacén de tokens FCM de dispositivos, bajo la colección `device_tokens`. Cada documento tiene como ID el propio token FCM, garantizando unicidad sin índice adicional:

```
device_tokens/{token}
  user_id:    "42"
  token:      "ExponentPushToken[xxx]"
  platform:   "expo" | "android" | "ios"
  created_at: <ServerTimestamp>
  updated_at: <ServerTimestamp>
```

La operación de registro es un upsert (`set(..., merge=True)`): si el token ya existe, solo actualiza `updated_at`. Esto garantiza idempotencia cuando la app llama al endpoint de registro repetidamente (al reiniciar, actualizar o reinstalar).

Firestore fue elegido porque vive en el mismo proyecto Firebase que FCM, no requiere levantar infraestructura adicional, y el patrón de acceso (escritura infrecuente, lectura por `user_id`) encaja naturalmente con su modelo de documentos. Agregar los tokens a PostgreSQL hubiera acoplado la gestión de tokens al ciclo de migraciones de user-api, que opera en un esquema distinto.

### Microservicio dedicado: notifications-api

Se introduce un **nuevo microservicio** (`bazaar-notifications-api`, Python/FastAPI) que centraliza toda la lógica de push notifications. Los demás servicios del ecosistema (orders-api, catalog-api) no tienen conocimiento de Firebase: simplemente hacen un `POST /notifications/push` con el `user_id`, el título, el cuerpo y el tipo de evento.

Este microservicio implementa **fire & forget en el lado del servidor**: el endpoint de push siempre responde 200. Si Firebase está caído, el token expiró o Firestore no responde, el error se loguea y se descarta. La operación del microservicio llamante (confirmar una orden, decrementar stock) no queda bloqueada por un fallo de notificaciones.

La autenticación hacia el endpoint de push se realiza mediante un **secret interno compartido** (`X-Internal-Secret`), distinto del JWT que usan los endpoints públicos. Este mecanismo evita que la app mobile o actores externos puedan enviar pushes arbitrarios a cualquier usuario.

### Deduplicación de alertas de stock

Para las alertas de stock bajo (`LOW_STOCK`) y sin stock (`OUT_OF_STOCK`) generadas por catalog-api, se implementa deduplicación mediante flags booleanos en el documento de cada producto en MongoDB (`lowStockAlertSent`, `outOfStockAlertSent`). Estos flags se setean atómicamente con `update_one` al momento de enviar la primera alerta, evitando que el mismo evento genere múltiples notificaciones al vendedor. Los flags se resetean cuando el stock se recupera.

### Resiliencia: retry con backoff exponencial en los callers

El envío de push desde orders-api y catalog-api hacia notifications-api usa el mismo patrón de **retry con backoff exponencial** definido en ADR 0009: 3 intentos máximos, delay base de 1 segundo, multiplicador de 2. El retry se ejecuta en un thread daemon (en Python) para no bloquear el response del endpoint principal.

## Alternativas descartadas

**Expo Push Notifications Service**: simplifica la integración del servidor (una única API en lugar de gestionar FCM + APNs por separado), pero introduce dependencia en la infraestructura de un tercero (Expo) para el flujo de producción. Si Expo tuviera un incidente, las notificaciones de toda la plataforma quedarían interrumpidas aunque FCM estuviera operativo. Usar FCM directamente elimina este intermediario.

**OneSignal**: tiene un SDK propio que requiere inicialización adicional en la app mobile y un dashboard de gestión externo. Al usar `expo-notifications` + FCM, toda la gestión ocurre dentro del código de la app sin herramientas externas. OneSignal es valioso para campañas de marketing con segmentación, pero el caso de uso de Bazaar es notificaciones transaccionales 1-a-1 que FCM cubre sin overhead adicional.

**AWS SNS**: bien integrado con la infraestructura AWS existente, pero requiere configurar tópicos, suscripciones y certificados APNs de forma separada, lo que aumenta la complejidad operativa respecto a FCM que gestiona ambas plataformas (Android e iOS) desde una única API.

**Tokens en PostgreSQL**: hubiera simplificado el diagrama de infraestructura al evitar Firestore, pero acopla la gestión de tokens al ciclo de migraciones de user-api. Cada cambio en el esquema de tokens (agregar campos, índices) requeriría una nueva migración de Prisma. Firestore permite evolucionar el esquema del documento sin migraciones.

**Tokens en Redis**: válido para alta velocidad de lectura, pero Redis no está en el stack actual. Levantar y operar una instancia de Redis solo para tokens de dispositivo no justifica el overhead operativo dado que Firestore ya está disponible en el proyecto Firebase.

## Consecuencias

### Positivas

- **Separación de responsabilidades**: ningún microservicio de negocio tiene código de Firebase. La lógica de push está aislada en notifications-api, que puede evolucionar independientemente.
- **Soporte nativo de Expo**: `expo-notifications` + FCM + `google-services.json` es la configuración oficial recomendada por Expo para producción. No requiere configuración adicional del SDK de Expo.
- **Sin infraestructura adicional**: Firestore y FCM viven en el mismo proyecto Firebase, gestionados con la misma Service Account key.
- **Idempotencia en registro de tokens**: el upsert en Firestore garantiza que llamadas repetidas al endpoint de registro no generan documentos duplicados.
- **Deduplicación de alertas de stock**: los flags en MongoDB evitan spam al vendedor si el stock fluctúa repetidamente alrededor del umbral.
- **Fire & forget**: los microservicios de negocio no quedan bloqueados por fallos de notificaciones.

### Negativas y Riesgos

- **Nueva dependencia de infraestructura**: se agrega Google Firebase/Firestore como proveedor al ecosistema. La `firebase-credentials.json` debe gestionarse como secreto en producción.
- **Sin confirmación de entrega**: FCM garantiza que el mensaje llegó a su infraestructura, no que el dispositivo lo recibió. Si el dispositivo está apagado, FCM intentará entregarlo cuando vuelva a estar online, pero no hay garantía de entrega. Para notificaciones críticas (pago rechazado, orden cancelada) el usuario puede perder la notificación si no tiene conectividad.
- **Tokens expirados no se limpian automáticamente**: cuando un usuario desinstala la app, su token queda en Firestore indefinidamente. FCM devuelve `UnregisteredError` al intentar enviar a ese token (loguead como warning), pero no hay un job de limpieza automática implementado. Con el tiempo, Firestore acumulará tokens inválidos.
- **Sin reintentos del lado del notifications-api hacia FCM**: el `FirebaseService` descarta los errores de FCM sin reintentar. Un error transitorio de FCM (500) hace que la notificación se pierda. Esta limitación es aceptable dado que el patrón fire & forget ya asume pérdida posible; un retry interno implicaría complejidad adicional (distinguir errores transitorios de permanentes en el SDK de Firebase).
- **Acoplamiento de `SECRET_KEY`**: notifications-api valida los JWT de la app mobile usando el mismo `SECRET_KEY` que user-api. Si user-api rota su clave, notifications-api debe actualizarse simultáneamente para evitar que todos los endpoints de registro/baja de tokens dejen de funcionar.
