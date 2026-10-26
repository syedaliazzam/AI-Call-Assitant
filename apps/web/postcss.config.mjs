/**
 * File: apps/web/postcss.config.mjs
 * Purpose: Runs Tailwind CSS (v4) over app/globals.css during dev and build.
 * Used by: Next.js CSS pipeline
 * Depends on: @tailwindcss/postcss
 */

/** PostCSS plugins: only Tailwind CSS. */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
