# ADR 0002: Persistencia (MongoDB y PostgreSQL)

## Estado
Aceptado

## Contexto
El sistema Bazaar requiere gestionar entidades con naturalezas y requisitos de almacenamiento muy distintos. 

Por un lado, el **Catálogo** debe soportar productos "sin límites de categoría", lo que implica que los atributos variarán enormemente entre un ítem y otro (ej: una notebook tiene especificaciones de RAM y procesador, mientras que una remera tiene talle y tela). 

Por otro lado, los dominios de **Órdenes** y **Pagos** manejan información financiera y transaccional crítica. Estos requieren garantías estrictas de consistencia, integridad referencial y prevención de condiciones de carrera (por ejemplo, evitar que dos usuarios compren el último ítem disponible de forma simultánea). 

Adicionalmente, los Requisitos No Funcionales (RNF) dictados por la cátedra exigen explícitamente el uso de al menos una tecnología de base de datos relacional (SQL) y una no relacional (NoSQL).

## Decisión
Decidimos implementar una estrategia de persistencia políglota, asignando el motor de base de datos que mejor se adapte al dominio de cada microservicio:

1. **MongoDB (hosteado en MongoDB Atlas)** para el **Catalog API**: Utilizaremos una base de datos orientada a documentos (NoSQL) para almacenar los productos y sus categorías.
2. **PostgreSQL (hosteado en Supabase)** para **User API, Orders & Checkout API y Payment API**: Usaremos una base de datos relacional (SQL).

## Consecuencias

### Positivas
* **Flexibilidad extrema en el Catálogo:** Al utilizar documentos JSON en MongoDB, evitamos estructuras rígidas o antipatrones de diseño en SQL (como tablas EAV - Entity-Attribute-Value, o tener decenas de columnas en estado `NULL`) para manejar los atributos dinámicos de los distintos productos.
* **Consistencia Transaccional:** PostgreSQL nos garantiza cumplimiento ACID (Atomicidad, Consistencia, Aislamiento, Durabilidad) para el manejo de stock, la generación de órdenes y la validación de idempotencia en los cobros.
* **Cumplimiento de RNF:** Se satisface plenamente el requisito arquitectónico de la materia de utilizar tecnologías de bases de datos heterogéneas.
* **Performance de lectura:** MongoDB Atlas está optimizado para consultas de lectura rápidas y flexibles, lo cual es ideal para el volumen de búsquedas que recibirá el catálogo.

### Negativas y Riesgos
* **Falta de Integridad Referencial Global:** Al estar los datos distribuidos en motores distintos, no existen claves foráneas directas (Foreign Keys) entre una Orden (en Postgres) y un Producto (en Mongo). La consistencia final (eventual consistency) y la validación estricta del stock al momento del checkout deberán resolverse a nivel de aplicación (comunicación entre microservicios) o mediante la implementación del patrón Saga.
* **Sobrecarga Operativa:** El equipo de desarrollo debe administrar, configurar credenciales, realizar backups y mantener esquemas/colecciones en dos proveedores cloud distintos (MongoDB Atlas y Supabase), lo que aumenta la curva de aprendizaje y el mantenimiento de la infraestructura.