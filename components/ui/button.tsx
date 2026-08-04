import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/85 active:bg-primary/85",
        secondary:
          "bg-secondary text-secondary-foreground border border-border hover:bg-muted active:bg-muted",
        ghost:
          "text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-muted active:bg-muted",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-6",
        /**
         * Talla añadida para esta app: el botón principal de cada parada.
         * Se pulsa con el pulgar, muchas veces de pie junto a la furgoneta,
         * así que necesita bastante más superficie que en un escritorio.
         */
        touch: "h-12 rounded-lg px-6 text-base [&_svg]:size-5",
        icon: "size-9",
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
