import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Service workers generados por Serwist en cada build: código
    // empaquetado y minificado, no fuente nuestra. El patrón cubre también
    // las copias que aparecen con sufijo (" 2") al duplicarse el archivo.
    "public/sw*.js",
    "public/sw*.js.map",
    "public/swe-worker*.js",
  ]),
  {
    rules: {
      // Convención: un nombre que empieza por "_" es intencionadamente
      // descartado (por ejemplo al quitar un campo con desestructuración).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
