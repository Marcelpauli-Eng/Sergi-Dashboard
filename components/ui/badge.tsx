import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Etiqueta de estado. Cápsula con el color del sistema al 15 %: el mismo
 * recurso que usa iOS para teñir un fondo sin que compita con el texto.
 * Sin mayúsculas forzadas, que en iOS no se estilan así.
 */
const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-muted text-foreground",
        secondary: "bg-muted text-muted-foreground",
        outline: "border border-border text-muted-foreground",
        success:
          "bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-success",
        warning:
          "bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] text-warning",
        danger:
          "bg-[color-mix(in_srgb,var(--destructive)_15%,transparent)] text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
