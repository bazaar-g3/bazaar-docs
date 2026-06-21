import http from 'k6/http';
import { check } from 'k6';

const USER_API   = 'http://localhost:8001';
const CATALOG_API = 'http://localhost:8002';

const imageData = open('./test_image.png', 'b');

export default function () {
  const loginRes = http.post(`${USER_API}/auth/login`, JSON.stringify({
    email: 'techstore@bazaar.dev',
    password: 'BazaarDev1',
  }), { headers: { 'Content-Type': 'application/json' } });

  check(loginRes, { 'login ok': (r) => r.status === 200 });
  const token = loginRes.json('accessToken');

  const productRes = http.post(`${CATALOG_API}/products/`, {
    name: 'Producto Test K6',
    description: 'Producto para pruebas de carga',
    price: '1000',
    stock: '999999',
    categorySlug: 'tecnologia',
    images: http.file(imageData, 'test_image.png', 'image/png'),
  }, {
    headers: { Authorization: `Bearer ${token}` },
  });

  check(productRes, { 'producto creado': (r) => r.status === 201 });
  console.log('Producto creado:', productRes.body);
}
