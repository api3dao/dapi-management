import * as React from 'react';
import { createContext, useContext, useImperativeHandle, useRef } from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

import { cn } from '~/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps extends React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root> {
  preventCloseOnClick?: boolean;
}

const Context = createContext<{
  preventCloseOnClick: boolean;
  triggerRef: React.RefObject<HTMLElement>;
} | null>(null);

const Tooltip = ({ preventCloseOnClick = false, ...props }: TooltipProps) => {
  const triggerRef = useRef<HTMLElement>(null);
  return (
    <Context.Provider value={{ preventCloseOnClick, triggerRef }}>
      <TooltipPrimitive.Root {...props} />
    </Context.Provider>
  );
};

const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(({ onClick, ...props }, ref) => {
  const ctx = useContext(Context)!;

  useImperativeHandle(ref, () => ctx.triggerRef.current as HTMLButtonElement);

  return (
    <TooltipPrimitive.Trigger
      ref={ctx.triggerRef as React.RefObject<HTMLButtonElement>}
      onClick={(ev) => {
        if (ctx.preventCloseOnClick) {
          // We don't want to close the tooltip when the trigger is clicked
          ev.preventDefault();
        }
        onClick?.(ev);
      }}
      {...props}
    />
  );
});

TooltipTrigger.displayName = TooltipPrimitive.Trigger.displayName;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, onPointerDownOutside, ...props }, ref) => {
  const ctx = useContext(Context)!;

  return (
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'bg-popover text-popover-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 z-50 overflow-hidden rounded bg-slate-700  px-3 py-1.5 text-xs text-slate-200 shadow-md',
        className
      )}
      onPointerDownOutside={(ev) => {
        if (ctx.preventCloseOnClick) {
          // We don't want to close the tooltip when the trigger is clicked
          if (ctx.triggerRef.current!.contains(ev.target as Node)) {
            ev.preventDefault();
          }
        }
        onPointerDownOutside?.(ev);
      }}
      {...props}
    />
  );
});
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
