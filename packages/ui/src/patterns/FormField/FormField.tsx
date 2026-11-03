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

export interface FieldControlProps {
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

/** Headless form wiring for custom layouts: it adds no elements or presentation classes. */
export function useFieldAccessibility(
  {
    id: explicitId,
    description,
    error,
    required,
  }: Pick<FormFieldProps, 'id' | 'description' | 'error' | 'required'>,
  existing: FieldControlProps = {},
) {
  const generatedId = React.useId();
  const id = existing.id ?? explicitId ?? generatedId;
  const descriptionId = description && !error ? `${id}-desc` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [...new Set([existing['aria-describedby'], descriptionId].filter(Boolean))].join(' ') ||
    undefined;
  return {
    id,
    descriptionId,
    errorId,
    controlProps: {
      id,
      required: existing.required ?? required,
      'aria-required': existing['aria-required'] ?? required,
      'aria-describedby': describedBy,
      'aria-errormessage': errorId ?? existing['aria-errormessage'],
      'aria-invalid': error ? true : existing['aria-invalid'],
    } satisfies FieldControlProps,
  };
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
  const {
    id: childId,
    descriptionId,
    errorId,
    controlProps,
  } = useFieldAccessibility({ id: explicitId, description, error, required }, children.props);
  const control = React.cloneElement(children, controlProps);

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
