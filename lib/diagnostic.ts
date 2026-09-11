import "server-only";
import { env } from "./env";
import { today } from "./dates";
import { findLatestTabUpTo, findMonthTab } from "./sheet-tab";
import {
  TAB_FACTURAS,
  listSheetTabs,
  puedeEscribir,
  type SheetDoc,
} from "./sheets";
import { TAB_IMPORTS } from "./importes";

/**
 * Qué le pasa a la configuración, contado desde el servidor que corre.
 *
 * Es el equivalente de `npm run check` pero desde dentro de la app, porque
 * `npm run check` solo mira el ordenador de quien lo ejecuta y esto se usa
 * desplegado. Cada comprobación dice qué arreglar, no solo que algo falla:
 * quien lo lee está mirando un móvil, no los logs de Vercel.
 *
 * Regla de oro: de aquí no sale un secreto. Ni claves, ni PINs, ni los IDs
 * enteros — solo su cola, que es lo que se compara con la URL del documento
 * que tienes abierto.
 */

export type EstadoComprobacion = "ok" | "aviso" | "error";

export interface Comprobacion {
  id: string;
  titulo: string;
  estado: EstadoComprobacion;
  detalle: string;
  /** Qué hacer. Solo cuando hay algo que hacer. */
  arreglo?: string;
}

/** Los últimos caracteres de un ID, para poder compararlo sin exponerlo. */
function cola(id: string): string {
  return id.length <= 6 ? id : `…${id.slice(-6)}`;
}

/** Traduce el fallo de Google a algo accionable. */
function porQueNoSeAbre(error: unknown, id: string): { detalle: string; arreglo: string } {
  const mensaje = error instanceof Error ? error.message : String(error);
  const codigo = mensaje.match(/respondió (\d{3})/)?.[1];

  if (codigo === "404") {
    return {
      detalle: `No existe ningún documento con ese ID (acaba en "${cola(id)}").`,
      arreglo:
        "El ID es el trozo de la URL entre /d/ y /edit. Comprueba que la cola " +
        "coincide con la del documento que tienes abierto.",
    };
  }
  if (codigo === "403") {
    return {
      detalle: `El documento existe pero la cuenta de servicio no puede entrar (acaba en "${cola(id)}").`,
      arreglo:
        `Ábrelo → Compartir → y ponle permiso de Editor a ${env.google.serviceAccountEmail}. ` +
        "Si ya aparece ahí, comprueba que es ESE documento: la cola del ID tiene que coincidir.",
    };
  }
  return {
    detalle: mensaje.slice(0, 300),
    arreglo: "",
  };
}

async function comprobarDocumento(
  id: string,
  doc: SheetDoc,
  etiqueta: string,
  pestañasEsperadas: string[],
): Promise<Comprobacion[]> {
  const salida: Comprobacion[] = [];
  let tabs: string[];

  try {
    tabs = await listSheetTabs(id);
  } catch (error) {
    const { detalle, arreglo } = porQueNoSeAbre(error, id);
    return [{ id: `${doc}-acceso`, titulo: `${etiqueta}: acceso`, estado: "error", detalle, arreglo }];
  }

  salida.push({
    id: `${doc}-acceso`,
    titulo: `${etiqueta}: acceso`,
    estado: "ok",
    detalle: `${tabs.length} pestañas. El ID acaba en "${cola(id)}".`,
  });

  // Leer no basta: la app crea pestañas y escribe filas. Compartido como
  // Lector todo parece bien hasta la primera entrega.
  const escritura = await puedeEscribir(id);
  salida.push(
    escritura.ok
      ? {
          id: `${doc}-escritura`,
          titulo: `${etiqueta}: permiso de escritura`,
          estado: "ok",
          detalle: "La cuenta de servicio puede escribir.",
        }
      : {
          id: `${doc}-escritura`,
          titulo: `${etiqueta}: permiso de escritura`,
          estado: "error",
          detalle: escritura.detalle,
          arreglo:
            `Está compartido como Lector. Ábrelo → Compartir → y cámbialo a ` +
            `Editor para ${env.google.serviceAccountEmail}.`,
        },
  );

  for (const pestaña of pestañasEsperadas) {
    salida.push({
      id: `${doc}-tab-${pestaña}`,
      titulo: `${etiqueta}: pestaña "${pestaña}"`,
      estado: tabs.includes(pestaña) ? "ok" : "aviso",
      detalle: tabs.includes(pestaña)
        ? "Creada."
        : "Todavía no existe; se crea sola la primera vez que haga falta.",
    });
  }

  return salida;
}

export async function comprobarConfiguracion(timezone: string): Promise<Comprobacion[]> {
  const salida: Comprobacion[] = [
    {
      id: "cuenta",
      titulo: "Cuenta de servicio",
      estado: "ok",
      detalle: env.google.serviceAccountEmail,
    },
  ];

  // ── La hoja de repartos ────────────────────────────────────────────────
  const repartos = env.google.sheetId;
  salida.push(...(await comprobarDocumento(repartos, "repartos", "Hoja de repartos", [])));

  // ¿Y hay pestaña para el mes de hoy?
  if (salida.every((c) => c.id !== "repartos-acceso" || c.estado === "ok")) {
    try {
      const tabs = await listSheetTabs(repartos);
      const mes = today(timezone).slice(0, 7);
      const delMes = findMonthTab(tabs, mes);
      const anterior = findLatestTabUpTo(tabs, mes);
      salida.push(
        delMes
          ? {
              id: "mes",
              titulo: "Pestaña del mes",
              estado: "ok",
              detalle: `Se está leyendo "${delMes}".`,
            }
          : {
              id: "mes",
              titulo: "Pestaña del mes",
              estado: "aviso",
              detalle: anterior
                ? `No existe la pestaña de ${mes}: se está leyendo "${anterior}", la más reciente.`
                : `No existe la pestaña de ${mes} ni ninguna anterior.`,
              arreglo:
                "Los pedidos de este mes no aparecerán hasta que la oficina cree " +
                "la pestaña. En cuanto exista, la app la coge sola.",
            },
      );
    } catch {
      // El acceso ya se ha reportado arriba.
    }
  }

  // ── El documento privado ───────────────────────────────────────────────
  const privado = env.google.facturasSheetId;
  if (!privado) {
    salida.push({
      id: "privado",
      titulo: "Documento privado (facturas e importes)",
      estado: "error",
      detalle: "GOOGLE_SHEET_ID_FACTURAS no está definida en este servidor.",
      arreglo:
        "Los importes y las facturas no tienen dónde guardarse. Añádela a las " +
        "variables de entorno del despliegue —marcándola para Production— y vuelve " +
        "a desplegar: cambiar una variable no reconstruye nada por su cuenta.",
    });
    return salida;
  }

  if (privado === repartos) {
    salida.push({
      id: "privado",
      titulo: "Documento privado (facturas e importes)",
      estado: "error",
      detalle: "Apunta al MISMO documento que ve la empresa.",
      arreglo:
        "Lo que cobras acabaría en la hoja de pedidos, que es justo lo que esta " +
        "separación evita. Crea un documento aparte y pon su ID.",
    });
    return salida;
  }

  salida.push(
    ...(await comprobarDocumento(privado, "privado", "Documento privado", [
      TAB_FACTURAS,
      TAB_IMPORTS,
    ])),
  );

  return salida;
}
