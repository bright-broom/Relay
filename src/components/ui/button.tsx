// shadcn/ui registry component, styled with Relay semantic tokens. See docs/COMPONENTS.md.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Slot } from "radix-ui";

const buttonVariants = cva("button", {
  variants: {
    variant: {
      default: "primary",
      destructive: "",
      outline: "",
      secondary: "",
      ghost: "ghost",
      link: "link-button",
    },
    size: {
      default: "",
      xs: "",
      sm: "",
      lg: "",
      icon: "icon-button",
      "icon-xs": "icon-button",
      "icon-sm": "icon-button",
      "icon-lg": "icon-button",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
