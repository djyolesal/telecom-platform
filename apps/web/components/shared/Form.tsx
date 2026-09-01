import { cn } from '@/lib/utils';

export function Field({
  label,
  required,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  error?: string;
  /** Précision affichée sous le champ : sert à expliquer un choix métier peu évident. */
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}

const baseInput =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#2471A3] focus:ring-2 focus:ring-[#2471A3]/20 outline-none disabled:bg-gray-50';

export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={cn(baseInput, props.className)} />
);

export const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} className={cn(baseInput, 'min-h-[80px]', props.className)} />
);

export function Select({
  options,
  placeholder,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <select {...props} className={cn(baseInput, 'bg-white', props.className)}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function FormCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-white rounded-xl border border-gray-100 p-6 shadow-sm max-w-3xl', className)}>
      {children}
    </div>
  );
}
