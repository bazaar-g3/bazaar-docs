# ADR 0011: Observabilidad con OpenTelemetry, Jaeger y Correlation ID

## Estado
Aceptado

## Contexto
Bazaar es una plataforma de microservicios donde un request del cliente móvil puede atravesar hasta cuatro servicios (user-api → orders-api → catalog-api → payment-api) antes de completarse. Sin un sistema de observabilidad, diagnosticar una falla en producción requería revisar los logs de cada servicio por separado sin ningún hilo conductor, lo que hacía prácticamente imposible reconstruir la secuencia de eventos.

Se necesitaba:
1. **Trazabilidad distribuida**: poder seguir un request concreto a lo largo de todos los servicios involucrados.
2. **Diagnóstico de fallas**: identificar en qué servicio y en qué operación ocurrió el error.
3. **Métricas operativas**: latencia por endpoint, tasa de errores, duración de queries.

## Decisión

### 1. OpenTelemetry como estándar de instrumentación
Se adopta **OpenTelemetry (OTel)** como el estándar de instrumentación para todos los servicios backend. OTel instrumenta automáticamente los frameworks (FastAPI, Express) y los drivers de base de datos (SQLAlchemy) generando spans que representan unidades de trabajo con su duración, estado y atributos.

### 2. Jaeger como backend de trazas
Los spans se exportan vía **OTLP HTTP** a una instancia de **Jaeger all-in-one**. La UI de Jaeger (`http://localhost:16686`) permite visualizar el árbol completo de un request distribuido, incluyendo tiempos y errores en cada servicio.

OTel está desactivado por defecto (`OTEL_ENABLED=false`) y se activa por variable de entorno, de modo que los entornos sin Jaeger (CI, testing local) no se ven afectados.

### 3. Correlation ID middleware en todos los servicios
Cada servicio implementa un middleware que:
- Lee el header `X-Request-ID` si viene del cliente móvil u otro servicio.
- Genera un UUID4 nuevo si no viene.
- Lo bindea al contexto del logger (structlog `contextvars` en Python, `AsyncLocalStorage` en Node.js) para que aparezca automáticamente en **todos** los logs del request sin pasarlo manualmente.
- Lo retorna en el header de respuesta para que el cliente pueda correlacionar sus propios registros.

### 4. Inyección de trace_id / span_id en logs
Cuando OTel está activo, los logs de structlog incluyen además el `trace_id` y `span_id` del span activo. Esto permite cruzar logs con trazas en Jaeger para un diagnóstico completo.

### 5. El cliente móvil genera y propaga el ID
El interceptor Axios de bazaar-mobile genera un UUID por request y lo incluye en el header `X-Request-ID`. Esto permite correlacionar eventos del cliente con los logs de backend.

## Alternativas descartadas

**Datadog / New Relic**: soluciones SaaS con excelente tooling pero con costo económico significativo. No adecuadas para el alcance de este proyecto.

**AWS X-Ray**: bien integrado con la infraestructura AWS existente, pero introduce vendor lock-in adicional y requiere instrumentación específica distinta de OTel. OTel permite cambiar el backend de trazas sin tocar el código de la aplicación.

**Logging centralizado como única solución (ELK/CloudWatch Logs)**: los logs sin trazas distribuidas son útiles pero insuficientes para diagnosticar latencias o fallas en cadenas de llamadas inter-servicio. El Correlation ID mitiga esto parcialmente, pero sin spans no se puede visualizar la jerarquía de llamadas.

**Sin observabilidad**: no es una opción aceptable en una plataforma con múltiples microservicios en producción.

## Consecuencias

### Positivas
- Un único `X-Request-ID` permite correlacionar logs de todos los servicios para un mismo request del usuario.
- OTel instrumenta FastAPI y SQLAlchemy automáticamente: no se requieren cambios en el código de negocio.
- El stack es vendor-neutral: cambiar de Jaeger a Tempo, Zipkin u otro backend compatible con OTLP no requiere modificar la aplicación.
- El Correlation ID funciona aunque OTel esté desactivado, lo que garantiza trazabilidad mínima en todos los entornos.

### Negativas y Riesgos
- **Jaeger no está en producción todavía**: se requiere agregar el servicio al docker-compose de producción o usar un backend OTLP gestionado (Grafana Cloud, etc.).
- **Overhead de red**: exportar spans consume ancho de banda. Mitigado con `BatchSpanProcessor`, que agrupa el envío.
- **Health checks excluidos**: los endpoints `/livez` y `/readyz` se excluyen del tracing para no saturar Jaeger con spans de bajo valor.
