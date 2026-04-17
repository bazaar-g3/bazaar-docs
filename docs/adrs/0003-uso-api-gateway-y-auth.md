# ADR 0003: Implementación de API Gateway y Autenticación Centralizada

## Estado
Aceptado

## Contexto
Para el Checkpoint 1 de Bazaar, implementamos el núcleo de gestión de identidades (registro, login, recupero de contraseña y login federado) y la exploración inicial del catálogo. Al contar con múltiples clientes (App Mobile y Backoffice) consumiendo diversos microservicios, exponer las URLs internas de cada uno directamente genera problemas de acoplamiento, seguridad y mantenimiento. Se requiere un mecanismo centralizado para validar la autenticidad de los usuarios antes de permitir el acceso a rutas protegidas.

## Decisión
Se decide implementar un **API Gateway (AWS API Gateway)** como punto único de entrada a la plataforma.

* El Gateway actúa como proxy reverso, enrutando peticiones externas hacia los microservicios correspondientes (ej. `/users/*` hacia User API, `/products/*` hacia Catalog API).
* La gestión de sesiones se realiza mediante **JSON Web Tokens (JWT)**.
* El API Gateway se encarga de interceptar las peticiones, verificar la firma del JWT y, solo si es válido, permitir el flujo hacia el microservicio interno.

## Consecuencias

### Positivas
* **Seguridad perimetral:** Los clientes no conocen la topología interna ni las URLs reales de los microservicios.
* **Desacoplamiento:** Los cambios en la ubicación o infraestructura de los servicios internos son transparentes para el front-end.
* **Centralización de Auth:** La lógica de validación de tokens se resuelve en un solo lugar, evitando duplicación de código en cada microservicio.

### Negativas y Riesgos
* **Punto único de falla:** Una mala configuración en el Gateway puede dejar a toda la plataforma inaccesible.
* **Vendor Lock-in:** La configuración es específica de AWS, lo que dificultaría una migración rápida a otros proveedores como Kong o NGINX.