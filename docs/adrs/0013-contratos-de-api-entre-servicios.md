---
title: "ADR 0013: Contratos de API entre Servicios — OpenAPI como Fuente de Verdad y Verificación Automatizada"
parent: ADRs
nav_order: 13
---
# ADR 0013: Contratos de API entre Servicios — OpenAPI como Fuente de Verdad y Verificación Automatizada

## Estado
Aceptado

## Contexto

Los microservicios de Bazaar se comunican entre sí mediante llamadas HTTP. Sin un mecanismo formal de contrato, un cambio en el schema de un proveedor (agregar un campo requerido, renombrar un enum, cambiar un tipo) puede romper silenciosamente a los consumers: los tests unitarios de cada servicio siguen pasando porque mockean las llamadas, pero la integración falla en producción.

Las comunicaciones inter-servicio del sistema son:

| Consumer | Proveedor | Endpoints involucrados |
|----------|-----------|----------------------|
| `orders-api` | `catalog-api` | batch-reserve-stock, batch-restore-stock, batch-mark-sold, coupons |
| `orders-api` | `payments-api` | POST /payments/, POST /refunds, GET /refunds/{id} |
| `orders-api` | `notifications-api` | POST /notifications/push |
| `catalog-api` | `notifications-api` | POST /notifications/push |
| `user-api` | `catalog-api` | Bloqueo/desbloqueo de productos de vendedor |

El objetivo es detectar incompatibilidades de contrato antes del deploy, sin requerir que todos los servicios estén corriendo simultáneamente.

Las alternativas evaluadas fueron:

- **Pact (Consumer-Driven Contract Testing)**: cada consumer define los contratos que espera, los sube a un Pact Broker, y el proveedor los verifica en su pipeline. Cobertura bidireccional completa, pero requiere un Pact Broker (infraestructura adicional) y coordinación entre los pipelines de CI de cada servicio.
- **Schemathesis**: herramienta que toma un schema OpenAPI y genera casos de prueba automáticamente, verificando que la implementación del proveedor cumple su propia especificación. Se ejecuta sin infraestructura adicional.
- **Dredd**: similar a Schemathesis, orientado a ejemplos en el schema. Requiere un servidor corriendo.
- **Validación manual de payloads (jsonschema)**: los consumers cargan el schema del proveedor y validan los payloads que construyen contra él. Sin generación automática de casos, pero sin dependencias de servidor ni broker.
- **Sin contratos formales**: solo tests de integración end-to-end. Detectan incompatibilidades pero requieren todos los servicios corriendo y son lentos en CI.

## Decisión

Se adopta **OpenAPI como fuente de verdad**, con una estrategia de tests de contrato aplicada **prioritariamente al flujo de notificaciones push** por ser el caso de mayor riesgo de incompatibilidad entre servicios.

### Herramientas adoptadas

- **Tests de contrato con TestClient (proveedor)**: `notifications-api` implementa tests provider-side en `tests/test_contract_schemathesis.py` usando el `TestClient` de FastAPI. Verifican que la implementación cumple su propio schema OpenAPI: status codes, estructura del body, valores del enum y requisitos de autenticación. No requieren servidor externo ni infraestructura adicional.
- **jsonschema (consumers)**: tests del lado consumer en `orders-api` y `catalog-api`. Cargan el schema exportado del proveedor y validan que los payloads que cada consumer construye cumplan el contrato, sin necesidad de levantar el servidor proveedor.

**Nota sobre Schemathesis**: se evaluó `schemathesis==3.34.0` para la generación automática de casos de prueba desde el schema OpenAPI (modo `from_asgi`). Sin embargo, Schemathesis 3.x no soporta OpenAPI 3.1.0, que es lo que FastAPI 0.111.0 genera por defecto, y la llamada a `schemathesis.from_asgi()` falla en tiempo de importación con `SchemaError`. Downgrader la versión de FastAPI o cambiar a Schemathesis 4.x (API completamente distinta) introduce más riesgo que beneficio para el scope actual. Los tests manuales con TestClient cubren el mismo conjunto de verificaciones relevantes para este proyecto.

### Schema como artefacto versionado

El schema OpenAPI de `notifications-api` se exporta como archivo estático a `bazaar-docs/contracts/notifications-api.openapi.json`. Este archivo:
- Es la fuente de verdad compartida entre proveedor y consumers.
- Se actualiza con `make export-schema` cuando el proveedor cambia su API.
- Vive en el repositorio de documentación (`bazaar-docs`) para que cualquier servicio pueda referenciarlo sin dependencia directa entre repos.

El comando de exportación genera el schema directamente desde el objeto FastAPI app (sin servidor corriendo), mockeando Firebase:

```bash
# En bazaar-notifications-api
make export-schema
```

### Alcance de la verificación automatizada

La verificación de contratos se implementa para el **flujo de notificaciones push**, que presenta el mayor riesgo por las siguientes razones:

1. **Dos consumers independientes**: tanto `orders-api` como `catalog-api` llaman a `POST /notifications/push`. Un cambio en el proveedor afecta a ambos simultáneamente.
2. **Enum cerrado de alto impacto**: `NotificationType` es validado por el proveedor con Pydantic. Si un consumer envía un tipo no registrado, el push falla silenciosamente (fire & forget). Los tests de contrato detectan esto antes del deploy.
3. **Campos requeridos no tipados en los clients**: los clients de notifications en orders-api y catalog-api construyen el payload como un dict Python sin tipado estático. La validación con jsonschema es la única verificación automática de que los campos requeridos (`user_id`, `title`, `body`) siempre están presentes.

### Flujos sin verificación automatizada de contrato

Los siguientes flujos inter-servicio no tienen tests de contrato implementados, por las razones indicadas:

| Flujo | Razón |
|-------|-------|
| `orders-api → catalog-api` (stock, cupones) | Los endpoints internos de catalog-api tienen cobertura de integración end-to-end en los tests de checkout existentes. El riesgo de incompatibilidad silenciosa es menor porque los errores de stock propagan HTTPException 409 explícita. |
| `orders-api → payments-api` | payments-api es un servicio con un contrato muy estable (POST /payments/ y POST /refunds). Los cambios de contrato son poco frecuentes y visibles porque rompen el checkout directamente (el usuario no puede pagar). |
| `user-api → catalog-api` | La llamada de bloqueo/desbloqueo de vendedor es una operación administrativa de baja frecuencia. user-api está en TypeScript; agregar jsonschema o una librería de validación de schemas OpenAPI requeriría una dependencia nueva en ese stack para un único endpoint. |

Estos flujos pueden incorporarse a la estrategia de contratos en el futuro si el volumen de cambios entre equipos aumenta o si se incorpora un Pact Broker como infraestructura de CI.

## Alternativas descartadas

**Pact (Consumer-Driven Contract Testing)**: descartado como primera implementación por requerir un Pact Broker (servidor adicional en la infraestructura de CI) y coordinación entre los pipelines de todos los servicios involucrados. El valor de Pact es máximo cuando los servicios son mantenidos por equipos distintos que no coordinan manualmente. En el contexto actual, donde todos los servicios son del mismo equipo y los cambios se coordinan en el mismo repositorio de documentación, la combinación Schemathesis + jsonschema ofrece el mismo nivel de detección con menor overhead operativo.

**Dredd**: descartado porque requiere un servidor HTTP corriendo para ejecutar los tests, lo que añade complejidad en CI (levantar el servicio con mocks de Firebase).

**Schemathesis vía `from_asgi`**: evaluado pero incompatible con el stack actual. Schemathesis 3.34.0 no soporta OpenAPI 3.1.0, formato que FastAPI 0.111.0 genera por defecto. La alternativa de forzar `openapi_version="3.0.3"` en FastAPI afecta el schema de producción (el que usan los clientes externos). Se optó por tests manuales con TestClient que logran la misma cobertura de verificación sin estas restricciones.

**Tests de integración end-to-end como único mecanismo**: los tests e2e son necesarios pero insuficientes para la detección de incompatibilidades de contrato, ya que requieren todos los servicios corriendo, son lentos, y no distinguen entre un fallo de contrato y un fallo de lógica de negocio.

## Consecuencias

### Positivas

- Un cambio en `NotificationType` (agregar o renombrar un valor) se detecta automáticamente: `test_notification_type_enum_values` falla si el schema del proveedor diverge del contrato exportado.
- Los consumers (orders-api, catalog-api) pueden verificar sus payloads sin levantar notifications-api.
- El schema exportado en `bazaar-docs/contracts/` actúa como documentación viva del contrato inter-servicio, accesible sin deployar ningún servicio.
- La estrategia es incremental: se puede extender a nuevos flujos agregando un archivo de schema exportado y un test de consumer.

### Negativas y Riesgos

- **Cobertura parcial**: los flujos `orders-api → catalog-api`, `orders-api → payments-api` y `user-api → catalog-api` no tienen verificación automatizada. Un cambio de contrato en esos flujos solo se detecta en los tests de integración o en producción.
- **Schema exportado puede desincronizarse**: si el desarrollador modifica notifications-api sin correr `make export-schema`, el archivo en `bazaar-docs/contracts/` queda desactualizado y los tests de consumer validan contra un contrato viejo. Mitigación recomendada: agregar `make export-schema` como paso previo al merge en el pipeline de CI de notifications-api.
- **Sin verificación bidireccional**: los tests actuales verifican que el consumer construye payloads válidos, pero no verifican que el proveedor acepte exactamente esos payloads (eso requeriría Pact o un test de integración). La combinación Schemathesis + jsonschema cubre los dos extremos por separado, no la interacción completa.
