import { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  title?: string;
}

const variants = {
  default: 'bg-blue-100 text-blue-800 border-blue-200',
  secondary: 'bg-gray-100 text-gray-800 border-gray-200',
  destructive: 'bg-red-100 text-red-800 border-red-200',
  outline: 'border border-gray-300 text-gray-700 bg-white',
};

export function Badge({ children, variant = 'default', className = '', style, onClick, title }: BadgeProps) {
  const variantClasses = variants[variant];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${onClick ? 'cursor-pointer' : ''} ${variantClasses} ${className}`}
      style={style}
      onClick={onClick}
      title={title}
    >
      {children}
    </span>
  );
}
