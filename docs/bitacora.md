---
title: Bitácora de Proyecto
nav_order: 3
---

# Bitácora de Proyecto

Registro cronológico del desarrollo de Bazaar: decisiones tomadas, correcciones recibidas y aprendizajes por checkpoint.

---

## Metodología de trabajo

- Reunión semanal obligatoria los **viernes**.
- Por cada épica nueva se creó un repositorio independiente dentro de la organización GitHub del equipo.
- Los repositorios se consolidaron bajo una **organización de GitHub** a partir del Checkpoint 2.
- Cobertura mínima de tests: **80%**, validada en CI/CD.

---

## Checkpoint 1

### Historias completadas

| Historia | Épica | Puntos |
|---|---|---|
| Registro de usuarios | Usuarios | 2 |
| Login con email y contraseña | Usuarios | 2 |
| Recupero de contraseña | Usuarios | 3 |
| Edición de perfil | Perfil | 3 |
| Visualización de perfil propio | Perfil | 1 |
| Home | Catálogo | 3 |
| Listado y búsqueda de productos | Catálogo | 3 |
| Publicar producto | Vendedor | 3 |
| Gestión de stock y publicaciones | Vendedor | 3 |
| Login con proveedor federado *(optativa)* | Usuarios | 3 |
| Visualización de perfil público *(optativa)* | Perfil | 2 |

### Correcciones recibidas durante el checkpoint

- Al hacer login, la app no redirigía a home correctamente → se corrigió el flujo de navegación post-autenticación.
- Al intentar registrarse con mail existente, el mensaje de email ya existente era demasiado explícito → se cambió por un mensaje de error genérico por seguridad.
- En la búsqueda, las imágenes no hacían resize → se implementó redimensionado de imágenes.

### Correcciones recibidas en la entrega

- Entregar la APK para la siguiente reunión semanal.
- Solucionar el layout visual en mobile.
- Implementar drag & drop en la carga de imágenes de productos.
- Para la presentación: enfocarse en **diagramas de flujo y tecnologías**, no en métodos de gestión.

---

## Checkpoint 2

### Historias completadas

| Historia | Épica | Puntos |
|---|---|---|
| Detalle de producto | Catálogo | 2 |
| Agregar producto al carrito | Carrito | 2 |
| Gestión del carrito | Carrito | 3 |
| Checkout e inicio de pago | Checkout y Órdenes | 8 |
| Estado y seguimiento de orden | Checkout y Órdenes | 5 |
| Historial de compras | Checkout y Órdenes | 2 |
| Historial de ventas | Vendedor | 3 |
| Compartir link de producto *(optativa)* | Catálogo | 2 |
| Productos populares en home *(optativa)* | Catálogo | 3 |
| Filtros avanzados de búsqueda *(optativa)* | Catálogo | 3 |
| Agregar / quitar de wishlist *(optativa)* | Wishlist | 2 |
| Visualización de wishlist *(optativa)* | Wishlist | 2 |

### Decisiones de diseño tomadas durante el checkpoint

**Carrito con fulfillments por vendedor**

Durante el sprint se debatió internamente cómo manejar un carrito con productos de múltiples vendedores. Se evaluaron dos opciones:

- Un carrito separado por vendedor.
- Un único carrito con fulfillments agrupados por vendedor.

Se optó por **un único carrito con fulfillments**: cada vendedor tiene su propio sub-historial dentro del carrito, el checkout se hace en un solo paso y el monto se distribuye por producto. Esto simplifica la experiencia del comprador y centraliza el flujo de pago.

### Correcciones recibidas en la entrega

- En mobile, al abrir el teclado virtual, tapaba el campo de texto que el usuario estaba completando → se ajustó el comportamiento del scroll para que la pantalla se acomode al teclado.

---

## Checkpoint 3

### Historias completadas

| Historia | Épica | Puntos |
|---|---|---|
| Listar usuarios del sistema | Administración | 1 |
| Bloquear y desbloquear usuario | Administración | 2 |
| Listar y moderar productos | Administración | 5 |
| Listar órdenes del sistema | Administración | 2 |
| Métricas del sistema | Métricas | 5 |
| Ordenamiento de resultados *(optativa)* | Catálogo | 2 |
| Calificar producto y vendedor *(optativa)* | Reviews | 5 |
| Reputación del vendedor en perfil público *(optativa)* | Reviews | 3 |
| Crear y gestionar cupones de descuento *(optativa)* | Vendedor | 5 |
| Aplicar cupón en checkout *(optativa)* | Checkout y Órdenes | 3 |
| Métricas por categoría *(optativa)* | Métricas | 3 |
| Exportar datos de métricas *(optativa)* | Métricas | 2 |

### Correcciones recibidas en la entrega

- Al bloquear un usuario, sus publicaciones seguían visibles en el catálogo → se implementó la propagación del bloqueo: al bloquear una cuenta de vendedor desde el backoffice, Catalog API oculta automáticamente todos sus productos.
- El CSV de exportación generaba un archivo por cada fila → se corrigió para que genere **un único archivo por período**.
- Se abrió la discusión sobre el manejo de cupones de código único: al no eliminarlos sino solo expirarlos, el código queda inutilizable permanentemente y no puede reutilizarse. Queda pendiente definir la política de reciclado de códigos.
