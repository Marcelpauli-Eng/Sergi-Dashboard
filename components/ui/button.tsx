import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Botones al estilo iOS: cápsulas, azul del sistema para la acción y gris
 * de relleno para lo secundario. No cambian de color al pasar el ratón
 * (en un móvil no hay ratón); la respuesta es el hundido al pulsar, que
 * llega en el instante en que el dedo toca la pantalla.
 */
const buttonVariants = cva(
  "pressable inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-primary",
        ghost: "text-primary",
        outline: "border border-border bg-transparent text-primary",
      },
      size: {
        default: "h-9 px-4 text-base [&_svg]:size-4",
        sm: "h-8 px-3.5 text-sm [&_svg]:size-4",
        lg: "h-11 px-6 text-base [&_svg]:size-5",
        /**
         * Talla añadida para esta app: el botón principal de cada parada.
         * Se pulsa con el pulgar, muchas veces de pie junto a la furgoneta,
         * así que necesita bastante más superficie que en un escritorio.
         */
        touch: "h-13 px-6 text-base font-semibold [&_svg]:size-5",
        icon: "size-9 [&_svg]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
