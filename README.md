# 🚗 AutoControl — Sistema de Control de Vehículos

## Instalación

1. Copia esta carpeta `autocontrol` en tu servidor
2. Entra a la carpeta:
   ```
   cd autocontrol
   ```
3. Instala dependencias:
   ```
   npm install
   ```
4. Cambia la contraseña en `server.js` línea 14:
   ```js
   PASSWORD: 'autocontrol2025',  ← CAMBIA ESTO
   ```
5. Inicia el servidor:
   ```
   node server.js
   ```
6. Abre en el navegador: **http://localhost:3001**

## Notas

- Corre en el **puerto 3001** (independiente de E.j Nails en 3000)
- La base de datos se crea automáticamente como `autos.db`
- Las fotos se guardan en `public/uploads/`
- Funciona en celular como PWA (agregar a pantalla de inicio)

## Módulos

| Módulo | Función |
|---|---|
| 🚗 Dashboard | Todos los vehículos con estado y alertas |
| 🔧 Mantenimiento | Cambio aceite, filtros, llantas, frenos... |
| 💥 Reparaciones | Choques, daños, trabajo no preventivo |
| 🧾 Facturas | Compras de repuestos, gastos varios |
| 📄 Documentos | SOAT, matrícula, revisión técnica |
