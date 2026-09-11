"use client";

import { useEffect, useState } from "react";
import { Download, FileCheck, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import Factura, { Hoja } from "@/components/factura";
import type { FacturaEmitida, Stop } from "@/lib/types";
import {
  clientePara,
  euros,
  fechaCorta,
  formatearNumero,
  paginar,
  type DatosFacturacion,
} from "@/lib/factura";
import { componerHoja } from "@/lib/factura-hoja";
import { descargarPdf } from "@/lib/pdf";

/** Las hojas de una factura ya emitida, compuestas para imprimir o exportar. */
function hojasDe(factura: FacturaEmitida, datos: DatosFacturacion) {
  const paginas = paginar(factura.lineas);
  return paginas.map((lineasPagina, i) =>
    componerHoja({
      datos,
      cliente: clientePara(datos, factura.client),
      numero: formatearNumero(factura.numero),
      lineas: lineasPagina,
      pagina: i + 1,
      paginas: paginas.length,
      fecha: fechaCorta(factura.fecha),
      totales:
        i === paginas.length - 1
          ? {
              base: factura.base,
              iva: factura.iva,
              irpf: factura.irpf,
              total: factura.total,
            }
          : null,
    }),
  );
}

/**
 * Las facturas ya emitidas.
 *
 * Salen de la pestaña "Factures" del mismo Google Sheet, que es donde las
 * registra el servidor al emitirlas. Cada una guarda sus propias líneas, así
 * que reimprimir una de hace tres meses da exactamente el mismo papel aunque
 * la hoja de pedidos haya cambiado desde entonces.
 *
 * Los datos de emisor y cliente sí salen de los ajustes actuales: si cambia
 * el domicilio, las reimpresiones lo llevan. Para facturas ya entregadas a
 * Hacienda eso no debería pasar, pero cambiar de domicilio y reimprimir una
 * antigua es raro, y guardar una copia de los datos en cada fila del Sheet
 * costaba más de lo que resuelve.
 */
export default function Factures({
  entregats,
  mes,
  datos,
  online,
  onImporte,
}: {
  /** Entregados de la hoja que esté seleccionada ahora mismo. */
  entregats: Stop[];
  mes: string;
  datos: DatosFacturacion;
  online: boolean;
  onImporte: (orderId: string, importe: number | null) => void;
}) {
  const [facturas, setFacturas] = useState<FacturaEmitida[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aImprimir, setAImprimir] = useState<FacturaEmitida | null>(null);
  const [facturant, setFacturant] = useState(false);
  // Cambia al emitir una factura: fuerza a releer el listado.
  const [recarrega, setRecarrega] = useState(0);

  const pendentsDeFacturar = entregats.filter((s) => s.price !== null && s.price > 0);
  // Lo que se va a facturar, en euros. El recuento de comandas no dice si
  // son cuatro portales o el mes entero, y es lo primero que se mira.
  const aFacturar = pendentsDeFacturar.reduce((total, s) => total + (s.price ?? 0), 0);

  useEffect(() => {
    let cancelado = false;
    void (async () => {
      try {
        const respuesta = await fetch("/api/facturas");
        const cuerpo = await respuesta.json().catch(() => null);
        if (!respuesta.ok) throw new Error(cuerpo?.error ?? "No s'han pogut carregar");
        if (!cancelado) setFacturas(cuerpo.facturas as FacturaEmitida[]);
      } catch (e) {
        if (!cancelado) setError(e instanceof Error ? e.message : "Error desconegut");
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [recarrega]);

  const paginas = aImprimir ? paginar(aImprimir.lineas) : [];

  return (
    <div className="space-y-6 lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
      {/* Facturar el mes que esté seleccionado, no solo el de hoy: si cambias
          de hoja desde el menú, aquí se factura esa. */}
      <div className="soft-card space-y-3 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Per facturar
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight">
            {euros(aFacturar)}
            <span className="ml-1 align-middle text-base font-medium text-muted-foreground">
              €
            </span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {mes || "Cap full seleccionat"} ·{" "}
            {pendentsDeFacturar.length}{" "}
            {pendentsDeFacturar.length === 1
              ? "entrega amb import"
              : "entregues amb import"}
          </p>
          {entregats.length > pendentsDeFacturar.length && (
            <p className="mt-1.5 text-sm text-warning-foreground">
              {entregats.length - pendentsDeFacturar.length} sense import: no hi
              entraran.
            </p>
          )}
        </div>
        <Button
          size="touch"
          className="w-full"
          disabled={entregats.length === 0}
          onClick={() => setFacturant(true)}
        >
          <FileCheck strokeWidth={2.2} />
          Generar factura
        </Button>
      </div>

      {facturant && (
        <Factura
          entregats={entregats}
          mes={mes}
          datos={datos}
          online={online}
          onImporte={onImporte}
          onEmesa={() => setRecarrega((n) => n + 1)}
          onTancar={() => setFacturant(false)}
        />
      )}

      <div>
        <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Emeses
        </h3>
        <p className="mb-3 px-1 text-xs text-muted-foreground">
          Registrades en el teu document de factures, a part del full de
          repartiment que comparteix l&apos;empresa.
        </p>

        {error && <p className="text-sm text-status-incidencia">{error}</p>}

        {facturas === null && !error && (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregant…</p>
        )}

        {facturas?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Encara no has emès cap factura des de l&apos;app.
          </p>
        )}

        {facturas && facturas.length > 0 && (
          <ul className="soft-card divide-y divide-border">
            {/*
              En el móvil la factura es una ficha: arriba número e importe,
              debajo de cuándo y de qué, y al final los dos botones con su
              nombre. Todo en una fila dejaba el "3 comandes" cortado por la
              mitad y dos iconos sin etiqueta de 44x32 px. De `sm` en
              adelante vuelve a caber de lado.
            */}
            {facturas.map((factura) => (
              <li key={factura.numero} className="px-4 py-4 sm:flex sm:items-center sm:gap-3 sm:py-3">
                <div className="flex items-baseline justify-between gap-3 sm:flex-1 sm:items-center">
                  <div className="min-w-0">
                    <p className="text-base font-semibold tabular-nums sm:text-sm">
                      {formatearNumero(factura.numero)}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground sm:truncate">
                      {fechaCorta(factura.fecha)} · {factura.periodo} ·{" "}
                      {factura.lineas.length}{" "}
                      {factura.lineas.length === 1 ? "comanda" : "comandes"}
                    </p>
                  </div>
                  <span className="shrink-0 text-base font-semibold tabular-nums sm:text-sm sm:font-medium">
                    {euros(factura.total)} €
                  </span>
                </div>

                <div className="mt-3 flex gap-2 sm:mt-0 sm:shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-10 flex-1 sm:min-h-0 sm:flex-none"
                    aria-label={`Descarregar en PDF la factura ${formatearNumero(factura.numero)}`}
                    onClick={() =>
                      descargarPdf(
                        hojasDe(factura, datos),
                        `factura-${formatearNumero(factura.numero)}`,
                      )
                    }
                  >
                    <Download />
                    <span className="sm:hidden">PDF</span>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-h-10 flex-1 sm:min-h-0 sm:flex-none"
                    aria-label={`Imprimir la factura ${formatearNumero(factura.numero)}`}
                    onClick={() => {
                      setAImprimir(factura);
                      // Un respiro para que la hoja esté en el DOM antes de que
                      // el navegador congele la página con el diálogo de imprimir.
                      setTimeout(() => window.print(), 100);
                    }}
                  >
                    <Printer />
                    <span className="sm:hidden">Imprimir</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Fuera de la pantalla; solo se ve al imprimir. */}
      {aImprimir && (
        <div className="factura-full" aria-hidden>
          {paginas.map((lineasPagina, i) => (
            <Hoja
              key={i}
              datos={datos}
              cliente={clientePara(datos, aImprimir.client)}
              numero={formatearNumero(aImprimir.numero)}
              lineas={lineasPagina}
              pagina={i + 1}
              paginas={paginas.length}
              fecha={fechaCorta(aImprimir.fecha)}
              totales={
                i === paginas.length - 1
                  ? {
                      base: aImprimir.base,
                      iva: aImprimir.iva,
                      irpf: aImprimir.irpf,
                      total: aImprimir.total,
                    }
                  : null
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
