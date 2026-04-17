# ADR 0001: Adopción de Arquitectura de Microservicios

## Estado
Aceptado

## Contexto
Para el desarrollo de la plataforma Bazaar (Ingeniería de Software II), necesitamos construir un sistema robusto que gestione múltiples dominios: usuarios, catálogos de productos sin límites de categoría, órdenes de compra transaccionales, pagos y notificaciones. 

Un enfoque monolítico tradicional presentaría dificultades operativas y de rendimiento. Por ejemplo, el catálogo de productos requiere manejar un volumen de tráfico y búsquedas mucho mayor que el backoffice administrativo, por lo que necesita escalar de forma diferente. Además, es un requisito crítico del negocio (y de la cátedra) que el fallo de un componente aislado (como la caída de la pasarela de pagos) no interrumpa la disponibilidad general del sistema, permitiendo que los usuarios sigan navegando por el catálogo.

## Decisión
Decidimos adoptar una arquitectura basada en **Microservicios**. El sistema se dividirá en servicios pequeños e independientes, donde cada uno tendrá la responsabilidad de un único dominio de negocio, poseerá su propia base de datos exclusiva y se desplegará por separado.

La estructura se divide en los siguientes repositorios y servicios principales:
* **User API (Python/FastAPI):** Gestión de cuentas, perfiles y autenticación.
* **Catalog API (Python/FastAPI):** Gestión de productos, categorías, imágenes y búsquedas.
* **Orders & Checkout API (Python/FastAPI):** Gestión del carrito, creación de órdenes y seguimiento. Es el núcleo transaccional.
* **Payment API (Python/FastAPI):** Integración con el gateway externo (Stripe/MercadoPago) manejando la idempotencia.
* **Notification API (Python/FastAPI):** Envío asincrónico de avisos (FCM).
* **AWS API Gateway:** Punto único de entrada para enrutar las peticiones de los clientes (Mobile App en React Native y Backoffice en React JS) hacia los microservicios, manejando además la validación de tokens.

Los microservicios backend se hostearán utilizando AWS App Runner para facilitar la integración continua y el despliegue automático.

## Consecuencias

### Positivas
* **Aislamiento de fallas (Resiliencia):** Si un microservicio se cae (ej. Notificaciones), el resto de la plataforma sigue operando con normalidad.
* **Escalabilidad independiente:** Podemos asignar más recursos de infraestructura únicamente a los servicios que más lo demanden (como Catalog API) sin sobreescalar el resto del sistema.
* **Despliegue independiente:** Cada equipo o desarrollador puede iterar, hacer push a GitHub y desplegar su microservicio en AWS App Runner sin afectar los ciclos de release de otros componentes.

### Negativas y Riesgos
* **Aumento de la complejidad operativa:** Mantener, monitorear y orquestar múltiples repositorios, entornos y bases de datos independientes requiere un esfuerzo de infraestructura mayor.
* **Transacciones distribuidas:** Al no existir transacciones ACID globales, se deberán implementar patrones como **Sagas** para flujos críticos (ej. confirmar orden, descontar stock y procesar pago) y asegurar la consistencia eventual.
* **Manejo de errores de red:** Se requiere un esfuerzo de desarrollo adicional para implementar lógica de **Idempotencia** (evitar cobros dobles) y **Circuit Breakers** (evitar llamadas en cascada a servicios caídos).