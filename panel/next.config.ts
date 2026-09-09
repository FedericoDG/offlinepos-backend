import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // El panel nunca sirve datos estaticos: todo sale del backend con el token
  // del admin, asi que no hay nada que prerenderizar ni cachear entre sesiones.
  reactStrictMode: true,
  // Solo desarrollo: permite abrir el panel por IP de red (ej. desde otra PC
  // de la LAN) sin que Next bloquee los recursos dev cross-origin (HMR y
  // chunks del cliente). Si cambia tu IP local, actualizá este valor.
  allowedDevOrigins: ['192.168.100.78'],
  // La subida de instaladores del POS supera por lejos el 1 MB por defecto
  // de las server actions (un MSI puede pasar los 30 MB).
  experimental: {
    serverActions: {
      bodySizeLimit: '64mb',
    },
  },
};

export default nextConfig;
