import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // El panel nunca sirve datos estaticos: todo sale del backend con el token
  // del admin, asi que no hay nada que prerenderizar ni cachear entre sesiones.
  reactStrictMode: true,
};

export default nextConfig;
