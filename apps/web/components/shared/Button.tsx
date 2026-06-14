import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-[#1B3F6B] text-white hover:bg-[#2471A3]',
  secondary: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-gray-600 hover:bg-gray-100',
};

interface BaseProps {
  variant?: Variant;
  loading?: boolean;
  icon?: React.ElementType;
  className?: string;
  children: React.ReactNode;
}

export function Button({
  variant = 'primary',
  loading,
  icon: Icon,
  className,
  children,
  ...props
}: BaseProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
        VARIANTS[variant],
        className
      )}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = 'primary',
  icon: Icon,
  className,
  children,
}: { href: string } & BaseProps) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
        VARIANTS[variant],
        className
      )}
    >
      {Icon && <Icon size={15} />}
      {children}
    </Link>
  );
}
