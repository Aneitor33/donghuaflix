# DonghuaFlix Personal — 0 €

Plataforma personal inspirada en servicios de streaming, alimentada automáticamente desde el catálogo público de Donghualife.

## Arquitectura recomendada

- **Frontend:** Cloudflare Pages (gratuito, estático y sin suspensión por inactividad).
- **Catálogo:** `public/data/catalog.json`.
- **Sincronización:** GitHub Actions cada 6 horas y también manualmente.
- **Repositorio:** puede ser privado.
- **Base de datos / servidor 24/7:** no hacen falta.

Cloudflare Pages puede conectarse a repositorios GitHub privados y desplegar cada cambio. GitHub Free incluye 2.000 minutos mensuales de Actions para repositorios privados; para un sync cada 6 horas normalmente hay margen amplio si la ejecución se mantiene corta.

## Puesta en marcha

1. Crea un repositorio nuevo en GitHub.
2. Sube todo este proyecto al repositorio.
3. Comprueba en **Actions** que el workflow `Sincronizar catálogo DonghuaFlix` puede ejecutarse manualmente.
4. Ejecuta una primera sincronización manual.
5. En Cloudflare: Workers & Pages → Create application → Pages → Connect to Git.
6. Selecciona el repositorio y publica la carpeta raíz como sitio estático. No hace falta build command; el proyecto ya contiene `public/` como raíz web si se configura el directorio de salida como `public`.

## Importante

- Solo se recopila información que Donghualife expone públicamente: fichas, temporadas, episodios y URLs/iframes de reproductores que estén visibles en sus páginas públicas.
- No se intenta saltar DRM, autenticación, paywalls ni restricciones de acceso.
- El sitio es una copia independiente del catálogo y no modifica Donghualife.
- La sincronización programada de GitHub puede ejecutarse con algo de retraso respecto a la hora exacta del cron.

## Desarrollo local

```bash
npm install
npm run sync:static
```

Después puedes servir `public/` con cualquier servidor estático.
