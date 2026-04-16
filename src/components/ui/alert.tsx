import { ReactNode } from 'react';

interface AlertProps {
  children: ReactNode;
  variant?: 'default' | 'destructive';
  className?: string;
}

interface AlertTitleProps {
  children: ReactNode;
  className?: string;
}

interface AlertDescriptionProps {
  children: ReactNode;
  className?: string;
}

const variants = {
  default: 'bg-blue-50 text-blue-800 border-blue-200',
  destructive: 'bg-red-50 text-red-800 border-red-200',
};

export function Alert({ children, variant = 'default', className = '' }: AlertProps) {
  const variantClasses = variants[variant];

  return (
    <div className={`relative w-full rounded-lg border p-4 ${variantClasses} ${className}`}>
      {children}
    </div>
  );
}

export function AlertTitle({ children, className = '' }: AlertTitleProps) {
  return (
    <h5 className={`mb-1 font-medium leading-none tracking-tight ${className}`}>
      {children}
    </h5>
  );
}

export function AlertDescription({ children, className = '' }: AlertDescriptionProps) {
  return (
    <div className={`text-sm ${className}`}>
      {children}
    </div>
  );
}
