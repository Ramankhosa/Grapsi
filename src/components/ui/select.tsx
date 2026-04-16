import { ReactNode, SelectHTMLAttributes, createContext, useContext, useState } from 'react';

interface SelectContextType {
  value: string;
  onValueChange: (value: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  disabled?: boolean;
}

const SelectContext = createContext<SelectContextType | undefined>(undefined);

interface SelectProps {
  children: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
}

interface SelectTriggerProps {
  children: ReactNode;
  className?: string;
}

interface SelectValueProps {
  placeholder?: string;
}

interface SelectContentProps {
  children: ReactNode;
  className?: string;
}

interface SelectItemProps {
  children: ReactNode;
  value: string;
  className?: string;
}

export function Select({ children, value, onValueChange, className = '', disabled = false }: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <SelectContext.Provider value={{ value, onValueChange, isOpen, setIsOpen, disabled }}>
      <div className={`relative ${className}`}>
        {children}
      </div>
    </SelectContext.Provider>
  );
}

export function SelectTrigger({ children, className = '' }: SelectTriggerProps) {
  const context = useContext(SelectContext);
  if (!context) throw new Error('SelectTrigger must be used within Select');

  return (
    <button
      type="button"
      disabled={context.disabled}
      className={`flex h-10 w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      onClick={() => !context.disabled && context.setIsOpen(!context.isOpen)}
    >
      {children}
      <svg className="h-4 w-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

export function SelectValue({ placeholder }: SelectValueProps) {
  const context = useContext(SelectContext);
  if (!context) throw new Error('SelectValue must be used within Select');

  return <span>{context.value || placeholder}</span>;
}

export function SelectContent({ children, className = '' }: SelectContentProps) {
  const context = useContext(SelectContext);
  if (!context) throw new Error('SelectContent must be used within Select');

  if (!context.isOpen) return null;

  return (
    <div className={`absolute z-50 min-w-[8rem] overflow-hidden rounded-md border border-gray-200 bg-white text-gray-950 shadow-md animate-in fade-in-80 ${className}`}>
      <div className="p-1">
        {children}
      </div>
    </div>
  );
}

export function SelectItem({ children, value, className = '' }: SelectItemProps) {
  const context = useContext(SelectContext);
  if (!context) throw new Error('SelectItem must be used within Select');

  return (
    <button
      className={`relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-gray-100 focus:text-gray-900 ${className}`}
      onClick={() => {
        context.onValueChange(value);
        context.setIsOpen(false);
      }}
    >
      {children}
    </button>
  );
}
