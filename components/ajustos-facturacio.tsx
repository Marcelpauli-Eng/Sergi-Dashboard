"use client";

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  guardarClientesAlDocument,
  guardarDatosFacturacion,
} from "@/lib/ajustes-factura";
import type { ClienteFacturacion, DatosFacturacion } from "@/lib/factura";

/**
 * Los datos que salen impresos en la factura.
 *
 * Se guardan en el móvil (ver lib/ajustes-factura.ts). Cambiarlos afecta a
 * las facturas que se emitan a partir de ahora y también a las reimpresiones
 * de las antiguas, porque el registro del full solo guarda las líneas y los
 * totales, no una copia de la cabecera.
 */

const CAMPOS_EMISOR: [keyof DatosFacturacion["emisor"], string][] = [
  ["nombre", "Nom o raó social"],
  ["direccion", "Adreça"],
  ["cp", "Codi postal"],
  ["poblacion", "Població"],
  ["provincia", "Província"],
  ["nif", "N.I.F."],
  ["telefono", "Telèfon"],
];

const CAMPOS_CLIENTE: [keyof ClienteFacturacion, string][] = [
  ["nombre", "Nom o raó social"],
  ["direccion", "Adreça"],
  ["cp", "Codi postal"],
  ["poblacion", "Població"],
  ["provincia", "Província"],
  ["codigo", "Codi de client"],
  ["nif", "N.I.F."],
];

const CLIENT_BUIT: ClienteFacturacion = {
  nombre: "",
  direccion: "",
  cp: "",
  poblacion: "",
  provincia: "",
  codigo: "",
  nif: "",
};

function Camp({
  etiqueta,
  valor,
  onCanvi,
}: {
  etiqueta: string;
  valor: string;
  onCanvi: (valor: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">
        {etiqueta}
      </span>
      <input
        value={valor}
        onChange={(e) => onCanvi(e.target.value)}
        className="w-full rounded-lg bg-muted px-3 py-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
    </label>
  );
}

export default function AjustosFacturacio({
  datos,
  onDesar,
  onTancar,
}: {
  datos: DatosFacturacion;
  onDesar: (datos: DatosFacturacion) => void;
  onTancar: () => void;
}) {
  const [esborrany, setEsborrany] = useState<DatosFacturacion>(datos);
  const [desant, setDesant] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canviarClient = (
    indice: number,
    clau: keyof ClienteFacturacion,
    valor: string,
  ) => {
    setEsborrany((d) => ({
      ...d,
      clientes: d.clientes.map((c, i) => (i === indice ? { ...c, [clau]: valor } : c)),
    }));
  };

  const afegirClient = () => {
    setEsborrany((d) => ({ ...d, clientes: [...d.clientes, { ...CLIENT_BUIT }] }));
  };

  const esborrarClient = (indice: number) => {
    // Nunca se queda sin ninguno: sin cliente no hay factura que emitir.
    setEsborrany((d) =>
      d.clientes.length <= 1
        ? d
        : { ...d, clientes: d.clientes.filter((_, i) => i !== indice) },
    );
  };

  /**
   * Guarda: primero en el móvil, después en el documento.
   *
   * En ese orden porque lo local no puede fallar y es lo que hace que la
   * factura se siga pudiendo componer sin cobertura. Los clientes además
   * suben a la pestaña "Clients" del documento privado, que es la copia
   * buena; si eso falla —sin red, o el documento sin configurar— se dice y
   * no se cierra, porque lo que se acaba de teclear solo estaría en este
   * teléfono y el de al lado seguiría con lo viejo.
   */
  const desar = async () => {
    guardarDatosFacturacion(esborrany);
    setDesant(true);
    setError(null);
    try {
      await guardarClientesAlDocument(esborrany.clientes);
    } catch (e) {
      setDesant(false);
      setError(
        `${e instanceof Error ? e.message : "No s'han pogut desar"}. ` +
          "Els clients s'han desat en aquest mòbil, però no al document.",
      );
      onDesar(esborrany);
      return;
    }
    setDesant(false);
    onDesar(esborrany);
    onTancar();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background lg:left-64">
      <div className="mx-auto max-w-lg space-y-6 px-4 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-2xl font-semibold tracking-tight">Dades de facturació</h2>
          <Button variant="ghost" size="touch" onClick={onTancar} aria-label="Tancar">
            <X />
          </Button>
        </div>

        <section className="space-y-3">
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Qui emet
          </h3>
          <div className="soft-card space-y-3 p-4">
            {CAMPOS_EMISOR.map(([clau, etiqueta]) => (
              <Camp
                key={clau}
                etiqueta={etiqueta}
                valor={esborrany.emisor[clau]}
                onCanvi={(valor) =>
                  setEsborrany((d) => ({ ...d, emisor: { ...d.emisor, [clau]: valor } }))
                }
              />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              A qui es factura
            </h3>
            <Button variant="ghost" size="sm" onClick={afegirClient}>
              <Plus />
              Afegir client
            </Button>
          </div>

          {/*
            El primero de la lista es el de por defecto: se le facturan todas
            las comandas que no digan otra cosa en la columna "Client
            facturació" de la hoja. Mientras solo haya uno, esa columna no
            hace falta para nada.
          */}
          <p className="px-1 text-xs text-tertiary-foreground">
            Amb més d&apos;un client, el <strong>codi de client</strong> és el que
            has de posar a la columna «Client facturació» del full per dir a qui
            se li factura cada comanda. Les comandes sense codi van al primer.
          </p>

          {esborrany.clientes.map((client, i) => (
            <div key={i} className="soft-card space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {client.nombre.trim() || `Client ${i + 1}`}
                  {i === 0 && (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      per defecte
                    </span>
                  )}
                </p>
                {esborrany.clientes.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Esborrar ${client.nombre.trim() || `client ${i + 1}`}`}
                    onClick={() => esborrarClient(i)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
              {CAMPOS_CLIENTE.map(([clau, etiqueta]) => (
                <Camp
                  key={clau}
                  etiqueta={etiqueta}
                  valor={client[clau]}
                  onCanvi={(valor) => canviarClient(i, clau, valor)}
                />
              ))}
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sèrie i article
          </h3>
          <div className="soft-card space-y-3 p-4">
            <Camp
              etiqueta="Codi d'article dels ports"
              valor={esborrany.articulo}
              onCanvi={(valor) => setEsborrany((d) => ({ ...d, articulo: valor }))}
            />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                Primer número de la sèrie
              </span>
              <input
                value={esborrany.primerNumero}
                onChange={(e) =>
                  setEsborrany((d) => ({
                    ...d,
                    primerNumero: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1),
                  }))
                }
                inputMode="numeric"
                className="w-full rounded-lg bg-muted px-3 py-2.5 text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Només s&apos;fa servir per a la primera factura que emetis des de
                l&apos;app. A partir d&apos;aquí el número surt de l&apos;última
                emesa. Ha de continuar on ho va deixar FactuSOL.
              </span>
            </label>
          </div>
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 lg:left-64 border-t border-border bg-background/95 p-4 backdrop-blur">
        <div className="mx-auto max-w-lg">
          {error && (
            <p className="mb-2 rounded-xl bg-warning-surface px-3 py-2 text-sm text-warning-foreground">
              {error}
            </p>
          )}
          <Button
            size="touch"
            className="w-full"
            disabled={desant}
            onClick={() => void desar()}
          >
            {desant ? "Desant…" : "Desar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
