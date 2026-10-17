import * as React from 'react';
import { cn } from '../../utils.js';

export interface FormFieldProps {
  id?: string;
  label?: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactElement<FieldControlProps>;
}

interface FieldControlProps {
  id?: string;
  required?: boolean;
  'aria-describedby'?: string;
  'aria-errormessage'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
}

export interface FormFieldContextValue {
  id: string;
  descriptionId?: string;
  errorId?: string;
  error?: React.ReactNode;
  required?: boolean;
}

export const FormFieldContext = React.createContext<FormFieldContextValue | null>(null);

export function useFormField(): FormFieldContextValue | null {
  return React.useContext(FormFieldContext);
}

export function FormField({
  id: explicitId,
  label,
  description,
  error,
  required,
  className,
  children,
}: FormFieldProps) {
  const generatedId = React.useId();
  const id = explicitId ?? generatedId;
  const descriptionId = description && !error ? `${id}-desc` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const childId = children.props.id ?? id;
  const describedBy =
    [children.props['aria-describedby'], descriptionId].filter(Boolean).join(' ') || undefined;
  const control = React.cloneElement(children, {
    id: childId,
    required: children.props.required ?? required,
    'aria-required': children.props['aria-required'] ?? required,
    'aria-describedby': describedBy,
    'aria-errormessage': errorId,
    'aria-invalid': error ? true : children.props['aria-invalid'],
  });

  const contextValue = React.useMemo<FormFieldContextValue>(
    () => ({
      id: childId,
      descriptionId,
      errorId,
      error,
      required,
    }),
    [childId, descriptionId, errorId, error, required],
  );

  return (
    <FormFieldContext.Provider value={contextValue}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        {label && (
          <label
            htmlFor={childId}
            className="text-text-main flex items-center gap-1 text-[11px] font-semibold select-none"
          >
            {label}
            {required && <span className="text-danger">*</span>}
          </label>
        )}
        <div>{control}</div>
        {description && !error && (
          <p id={descriptionId} className="text-text-muted/70 text-[10.5px]">
            {description}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="text-danger text-[10.5px] font-medium">
            {error}
          </p>
        )}
      </div>
    </FormFieldContext.Provider>
  );
}
