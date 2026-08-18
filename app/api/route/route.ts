import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { readSheet } from "@/lib/sheets";
import { fillMissingCoordinates, getDepotCoord } from "@/lib/manifest";
import { optimizeRoute, navUrlFor, fullRouteUrlFor } from "@/lib/routing";
import { env } from "@/lib/env";
import type { Order, Stop } from "@/lib/types";

/**
 * Genera la ruta optimizada bajo demanda.
 *
 * Solo se llama cuando el transportista pulsa "Generar ruta", para no
 * gastar tokens de Google Routes API en cada sincronización.
 */
export async function POST(request: NextRequest) {
  const driver = await getSession();
  if (!driver) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      orderIds: string[];
      sheetTab?: string;
      startLocation?: { lat: number; lng: number };
      forceOrder?: boolean;
    };

    if (!body.orderIds || body.orderIds.length === 0) {
      return NextResponse.json(
        { error: "No se han proporcionado pedidos" },
        { status: 400 },
      );
    }

    const snapshot = await readSheet(body.sheetTab);
    const orderMap = new Map(snapshot.orders.map((o) => [o.id, o]));
    const orders: Order[] = body.orderIds
      .map((id) => orderMap.get(id))
      .filter((o): o is Order => o !== undefined);

    if (orders.length === 0) {
      return NextResponse.json(
        { error: "No se encontraron los pedidos" },
        { status: 404 },
      );
    }

    await fillMissingCoordinates(orders, snapshot);
    
    // Usar la ubicación del usuario si está disponible, o el almacén por defecto.
    const depot = body.startLocation || await getDepotCoord();
    
    const result = await optimizeRoute(depot, orders, body.forceOrder);

    const stops: Stop[] = result.ordered.map((order, index) => {
      const { rowNumber: _rowNumber, ...rest } = order;
      return {
        ...rest,
        sequence: index + 1,
        navUrl: navUrlFor(order),
        legDistanceMeters: result.legs[index]?.distanceMeters ?? null,
        legDurationSeconds: result.legs[index]?.durationSeconds ?? null,
      };
    });

    return NextResponse.json({
      stops,
      optimized: result.optimized,
      fullRouteUrl: fullRouteUrlFor(
        body.startLocation ? `${body.startLocation.lat},${body.startLocation.lng}` : env.depotAddress, 
        result.ordered
      ),
      totalDistanceMeters: result.totalDistanceMeters,
      totalDurationSeconds: result.totalDurationSeconds,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Error generando la ruta:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se ha podido generar la ruta",
      },
      { status: 500 },
    );
  }
}
