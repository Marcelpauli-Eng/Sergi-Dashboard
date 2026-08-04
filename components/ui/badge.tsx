import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default: "border-border bg-muted text-foreground",
        secondary: "border-border bg-muted text-muted-foreground",
        outline: "border-border text-muted-foreground",
        success: "border-green-300 bg-green-50 text-green-700",
        warning: "border-amber-300 bg-amber-50 text-amber-700",
        danger: "border-red-300 bg-red-50 text-red-700",
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
