import { ComponentPropsWithoutRef } from 'react';

export function UnifiedDiffIcon(props: ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 50" width={48} height={50} fill="none" {...props}>
      <g filter="url(#a)">
        <rect width={48} height={48} fill="#fff" rx={6} />
        <rect width={46.5} height={46.5} x={0.75} y={0.75} stroke="#D0D7DE" strokeWidth={1.5} rx={5.25} />
      </g>
      <rect width={42} height={4.5} x={3} y={3} fill="#CFFED9" rx={2.25} />
      <rect width={9} height={4.5} x={3} y={3} fill="#81EB9C" rx={2.25} />
      <rect width={21} height={4.5} x={19.5} y={9} fill="#AEF1BF" rx={2.25} />
      <rect width={42} height={4.5} x={3} y={9} fill="#CFFED9" rx={2.25} />
      <rect width={21} height={4.5} x={19.5} y={9} fill="#81EB9C" rx={2.25} />
      <rect width={42} height={4.5} x={3} y={15} fill="#FFEEF0" rx={2.25} />
      <rect width={27} height={4.5} x={3} y={15} fill="#FCB3BC" rx={2.25} />
      <rect width={42} height={4.5} x={3} y={21} fill="#FAFBFC" rx={2.25} />
      <rect width={42} height={4.5} x={3} y={27} fill="#FFEEF0" rx={2.25} />
      <rect width={36} height={4.5} x={3} y={27} fill="#FCB3BC" rx={2.25} />
      <rect width={42} height={4.5} x={3} y={33} fill="#CFFED9" rx={2.25} />
      <rect width={27} height={4.5} x={6} y={33} fill="#81EB9C" rx={2.25} />
      <rect width={42} height={4.5} x={3} y={39} fill="#CFFED9" rx={2.25} />
      <rect width={6} height={4.5} x={30} y={39} fill="#81EB9C" rx={2.25} />
      <rect width={9} height={4.5} x={18} y={39} fill="#81EB9C" rx={2.25} />
      <defs>
        <filter
          id="a"
          width={48}
          height={49.5}
          x={0}
          y={0}
          colorInterpolationFilters="sRGB"
          filterUnits="userSpaceOnUse"
        >
          <feFlood floodOpacity={0} result="BackgroundImageFix" />
          <feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
          <feOffset dy={1.5} />
          <feColorMatrix values="0 0 0 0 0.584314 0 0 0 0 0.615686 0 0 0 0 0.647059 0 0 0 0.1 0" />
          <feBlend in2="BackgroundImageFix" result="effect1_dropShadow" />
          <feBlend in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
        </filter>
      </defs>
    </svg>
  );
}
