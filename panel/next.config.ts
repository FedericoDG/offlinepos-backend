import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // El panel nunca sirve datos estaticos: todo sale del backend con el token
  // del admin, asi que no hay nada que prerenderizar ni cachear entre sesiones.
  // Ruta pública del panel en el VPS: se sirve bajo
  // https://vps1-binario.duckdns.org/panel-pos-offline (routing por path en
  // el nginx central, no subdominio propio). Next necesita conocerse esa
  // base para emitir los assets con el prefix correcto.
  basePath: '/panel-pos-offline',
  reactStrictMode: true,
  // Solo desarrollo: permite abrir el panel por IP de red (ej. desde otra PC
  // de la LAN) sin que Next bloquee los recursos dev cross-origin (HMR y
  // chunks del cliente). Si cambia tu IP local, actualizá este valor.
  allowedDevOrigins: ['192.168.100.78'],
  // La subida de instaladores del POS supera por lejos los límites por defecto
  // (un MSI puede pasar los 30 MB y el form lleva 4 archivos en un solo request).
  // Next 16 renombró middleware → proxy y ambas claves a la vez son error.
  experimental: {
    serverActions: {
      bodySizeLimit: '128mb',
    },
    proxyClientMaxBodySize: '128mb',
  },
};

export default nextConfig;
