# ADR 0003: API Gateway como Punto Único de Entrada — Enrutamiento, Autenticación y Rate Limiting

## Estado
Aceptado — Implementado

## Contexto
Bazaar está compuesto por múltiples microservicios independientes (user-api, catalog-api, orders-api, payment-api, notifications-api) consumidos por dos clientes distintos: la app mobile y el backoffice. Exponer las URLs internas de cada servicio directamente genera tres problemas concretos:

1. **Acoplamiento cliente-infraestructura:** cualquier cambio de URL o puerto rompe los clientes.
2. **Superficie de ataque amplia:** cada servicio expuesto individualmente multiplica los vectores de entrada.
3. **Duplicación de lógica transversal:** validación de tokens, rate limiting y CORS deben implementarse en cada servicio por separado.

Se requiere un mecanismo centralizado que actúe como única puerta de entrada al sistema, resolviendo enrutamiento, autenticación y protección contra abuso de forma uniforme.

## Decisión
Se implementa **AWS API Gateway (HTTP API)** como punto único de entrada a la plataforma Bazaar, desplegado en la región `us-east-1` bajo el ID `bazaar-api-gateway (zvh5k42p9f)`.

### 1. Enrutamiento centralizado
El Gateway define rutas que mapean cada prefijo de URL al microservicio correspondiente desplegado en la instancia EC2:

| Ruta                        | Servicio destino     |
|-----------------------------|----------------------|
| `/auth/*`, `/users/*`       | user-api             |
| `/products/*`, `/categories/*` | catalog-api       |
| `/orders/*`, `/cart/*`      | orders-api           |
| `/payments/*`, `/webhooks/*`| payment-api          |
| `/notifications/*`          | notifications-api    |

Internamente, la EC2 corre NGINX como reverse proxy que distribuye el tráfico recibido del Gateway hacia los contenedores Docker de cada servicio.

### 2. Validación de tokens (JWT)
La gestión de sesiones utiliza **JSON Web Tokens (JWT)**. La validación opera en dos capas:

- **Gateway:** verifica la presencia del header `Authorization: Bearer <token>` antes de enrutar la petición. Las rutas públicas (registro, login, webhooks de MercadoPago) están explícitamente excluidas de esta verificación.
- **Microservicio:** cada servicio re-valida la firma del JWT usando la `JWT_SECRET` compartida vía variable de entorno, asegurando que un token manipulado no pueda ser aceptado aunque llegue al servicio interno.

### 3. Rate limiting (Throttling)
Se configura throttling a nivel del stage `prod` en AWS API Gateway con los siguientes valores:

- **Rate limit:** 100 requests/segundo (régimen sostenido)
- **Burst limit:** 200 requests (pico simultáneo)

Estos límites aplican a todas las rutas por defecto. Adicionalmente, `user-api` implementa rate limiting por aplicación sobre los endpoints de mayor riesgo:

- Login por IP: evita fuerza bruta distribuida
- Login por cuenta (email): evita fuerza bruta aunque roten IPs
- Recupero de contraseña por IP: evita enumeración de cuentas y abuso de envío de emails

## Alternativas descartadas

### Kong / NGINX API Gateway standalone
Requieren infraestructura adicional, configuración manual de plugins y mayor carga operativa. AWS API Gateway ofrece las mismas capacidades con administración simplificada y sin servidores adicionales.

### Validación de JWT exclusivamente en cada microservicio (sin Gateway)
Implementado inicialmente en un checkpoint anterior. Se descarta como mecanismo principal porque no ofrece bloqueo perimetral: una petición sin token llega al servicio y consume recursos antes de ser rechazada.

## Consecuencias

### Positivas
- **Seguridad perimetral:** los clientes nunca conocen las URLs internas ni los puertos de los microservicios.
- **Desacoplamiento:** refactorizaciones internas (cambio de puerto, migración de servicio) son transparentes para los clientes.
- **Rate limiting centralizado:** una sola configuración protege todos los servicios contra abuso y ataques de denegación de servicio.
- **Observabilidad:** AWS CloudWatch registra métricas de latencia, errores y throttling por ruta sin instrumentación adicional.

### Negativas y Riesgos
- **Punto único de falla:** una mala configuración en el Gateway puede dejar toda la plataforma inaccesible.
- **Vendor lock-in:** la configuración es específica de AWS; migrar a otro proveedor requiere reconfigurar rutas, autorizadores y throttling.
- **Costo:** AWS API Gateway cobra por millón de requests. Para el volumen actual del proyecto el costo es marginal, pero escala con el tráfico.