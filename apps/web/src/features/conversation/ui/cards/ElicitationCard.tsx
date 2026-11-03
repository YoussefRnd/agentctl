import { getErrorMessage } from '@/shared/lib/feedback';
import React, { useState } from 'react';
import {
  getElicitationValidationError,
  type ElicitationItem,
  type ElicitationResponse,
} from '@agentctl/shared';
import { Card, CardHeader, CardContent, CardFooter, Button, Input, Select } from '@agentctl/ui';

export interface ElicitationCardProps {
  elicitation: ElicitationItem;
  onRespond?: (elicitationId: string, response: ElicitationResponse) => void | Promise<void>;
  disabled?: boolean;
}

export const ElicitationCard: React.FC<ElicitationCardProps> = ({
  elicitation,
  onRespond,
  disabled = false,
}) => {
  const { request, status } = elicitation;
  const isForm = request.mode === 'form';
  const isUrl = request.mode === 'url';
  const [submitting, setSubmitting] = useState(false);
  const [responseError, setResponseError] = useState<string>();
  const unavailable = disabled || submitting;

  const [formValues, setFormValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    if (request.form?.fields) {
      for (const field of request.form.fields) {
        if (field.default !== undefined) {
          initial[field.id] = field.default;
        } else if (field.type === 'boolean') {
          initial[field.id] = false;
        } else if (field.type === 'multi_select') {
          initial[field.id] = [];
        } else {
          initial[field.id] = '';
        }
      }
    }
    return initial;
  });

  const submissionValues = Object.fromEntries(
    Object.entries(formValues).filter(([id, value]) => {
      const field = request.form?.fields.find((field) => field.id === id);
      return field?.required || (value !== '' && !(Array.isArray(value) && value.length === 0));
    }),
  );
  const validationError = getElicitationValidationError(request, {
    action: 'submit',
    values: submissionValues,
  });
  const isPending = status === 'pending';
  const isFormValid =
    !isForm ||
    (!validationError &&
      (request.form?.fields.every((field) => {
        const value = formValues[field.id];
        if (Array.isArray(value)) return !field.required || value.length > 0;
        return !field.required || (value !== undefined && value !== null && value !== '');
      }) ??
        false));

  const cardStatus =
    status === 'completed'
      ? 'success'
      : status === 'cancelled' || status === 'declined'
        ? 'error'
        : 'pending';

  const handleInputChange = (fieldId: string, val: unknown) => {
    setFormValues((prev) => ({
      ...prev,
      [fieldId]: val,
    }));
  };

  const respond = async (response: ElicitationResponse) => {
    if (!isPending || !onRespond || unavailable) return;
    setSubmitting(true);
    setResponseError(undefined);
    try {
      await onRespond(elicitation.id, response);
    } catch (error) {
      setResponseError(getErrorMessage(error, 'Could not submit the response. Try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (event?: React.SyntheticEvent) => {
    event?.preventDefault();
    if (!isFormValid) return;
    void respond({ action: 'submit', values: isForm ? submissionValues : undefined });
  };
  const handleCancel = () => {
    void respond({ action: 'cancel' });
  };
  const handleDecline = () => {
    void respond({ action: 'decline' });
  };
  const handleOpenUrl = () => {
    if (!isPending || !onRespond || unavailable || !request.url) return;
    window.open(request.url.url, '_blank', 'noopener,noreferrer');
    void respond({ action: 'submit' });
  };

  return (
    <Card status={cardStatus} className="my-3 [overflow-wrap:anywhere] shadow-lg backdrop-blur-md">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="bg-accent/20 text-accent rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase">
            {isForm ? 'Form Request' : 'External Authorization'}
          </span>
          <span className="text-text-muted font-mono text-xs">ID: {elicitation.id}</span>
          {request.subagentId && (
            <span className="text-text-muted text-xs">Subagent: {request.subagentId}</span>
          )}
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase ${
            status === 'pending'
              ? 'bg-warning/20 text-warning'
              : status === 'completed'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-rose-500/20 text-rose-400'
          }`}
        >
          {status}
        </span>
      </CardHeader>

      <CardContent className="space-y-3">
        <p className="text-text-muted text-[11px] leading-relaxed">{request.message}</p>

        {isForm && request.form && (
          <form
            id={`elicitation-form-${elicitation.id}`}
            onSubmit={handleSubmit}
            className="space-y-3"
          >
            {request.form.title && (
              <h4 className="text-text-main text-xs font-bold">{request.form.title}</h4>
            )}
            {request.form.description && (
              <p className="text-text-muted text-[11px] leading-relaxed">
                {request.form.description}
              </p>
            )}

            <div className="space-y-2.5 pt-1">
              {request.form.fields.map((field) => (
                <div key={field.id} className="flex flex-col gap-1">
                  {field.type !== 'boolean' && (
                    <label
                      htmlFor={`elicitation-${elicitation.id}-${field.id}`}
                      className="text-text-muted text-[11px] font-semibold"
                    >
                      {field.label}
                      {field.required && <span className="ml-1 text-rose-400">*</span>}
                    </label>
                  )}

                  {field.type === 'select' ? (
                    <Select
                      id={`elicitation-${elicitation.id}-${field.id}`}
                      value={
                        typeof formValues[field.id] === 'string'
                          ? (formValues[field.id] as string)
                          : ''
                      }
                      disabled={!isPending || unavailable}
                      onChange={(val) => {
                        handleInputChange(field.id, val);
                      }}
                      placeholder="Select option..."
                      options={
                        field.options?.map((opt) => ({
                          value: opt.value,
                          label: opt.label,
                        })) ?? []
                      }
                    />
                  ) : field.type === 'multi_select' ? (
                    <div className="space-y-1">
                      {field.options?.map((option) => {
                        const selected = Array.isArray(formValues[field.id])
                          ? (formValues[field.id] as string[])
                          : [];
                        return (
                          <label
                            key={option.value}
                            className="text-text-muted flex cursor-pointer items-start gap-2 text-[11px]"
                          >
                            <input
                              type="checkbox"
                              checked={selected.includes(option.value)}
                              disabled={
                                !isPending ||
                                unavailable ||
                                (!selected.includes(option.value) &&
                                  field.maxItems !== undefined &&
                                  selected.length >= field.maxItems)
                              }
                              onChange={(event) => {
                                handleInputChange(
                                  field.id,
                                  event.target.checked
                                    ? [...selected, option.value]
                                    : selected.filter((value) => value !== option.value),
                                );
                              }}
                              className="border-border bg-surface text-accent focus:ring-accent/20 mt-0.5 rounded"
                            />
                            <span>
                              {option.label}
                              {option.description && (
                                <span className="text-text-subtle block">{option.description}</span>
                              )}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : field.type === 'boolean' ? (
                    <label className="text-text-muted flex cursor-pointer items-center gap-2 text-[11px] font-semibold">
                      <input
                        type="checkbox"
                        checked={Boolean(formValues[field.id])}
                        disabled={!isPending || unavailable}
                        onChange={(e) => {
                          handleInputChange(field.id, e.target.checked);
                        }}
                        className="border-border bg-surface text-accent focus:ring-accent/20 rounded"
                      />
                      <span>Enable {field.label}</span>
                    </label>
                  ) : (
                    <Input
                      id={`elicitation-${elicitation.id}-${field.id}`}
                      type={
                        field.type === 'number' || field.type === 'integer'
                          ? 'number'
                          : field.format === 'email'
                            ? 'email'
                            : 'text'
                      }
                      value={
                        typeof formValues[field.id] === 'string' ||
                        typeof formValues[field.id] === 'number'
                          ? String(formValues[field.id])
                          : ''
                      }
                      disabled={!isPending || unavailable}
                      required={field.required}
                      min={field.minimum}
                      max={field.maximum}
                      minLength={field.minLength}
                      maxLength={field.maxLength}
                      pattern={field.pattern}
                      step={field.type === 'integer' ? 1 : undefined}
                      onChange={(e) => {
                        handleInputChange(
                          field.id,
                          field.type === 'number' || field.type === 'integer'
                            ? e.target.value === ''
                              ? ''
                              : Number(e.target.value)
                            : e.target.value,
                        );
                      }}
                      placeholder={`Enter ${field.label.toLowerCase()}...`}
                    />
                  )}
                  {field.description && (
                    <p className="text-text-subtle text-[10px]">{field.description}</p>
                  )}
                </div>
              ))}
            </div>
          </form>
        )}

        {isUrl && request.url && (
          <div className="space-y-3">
            {request.url.title && (
              <h4 className="text-text-main text-xs font-bold">{request.url.title}</h4>
            )}
            {request.url.description && (
              <p className="text-text-muted text-[11px] leading-relaxed">
                {request.url.description}
              </p>
            )}

            <div className="bg-surface/50 border-border/40 rounded-lg border p-2.5">
              <span className="text-text-muted font-mono text-[11px] break-all">
                {request.url.url}
              </span>
            </div>
          </div>
        )}
        {responseError && (
          <p role="alert" className="text-xs text-rose-400">
            {responseError}
          </p>
        )}
      </CardContent>

      {isPending && (
        <CardFooter className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleCancel} disabled={unavailable}>
            Cancel
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDecline} disabled={unavailable}>
            Decline
          </Button>
          <Button
            variant="solid"
            size="sm"
            type={isForm ? 'submit' : 'button'}
            form={isForm ? `elicitation-form-${elicitation.id}` : undefined}
            onClick={isForm ? undefined : handleOpenUrl}
            disabled={unavailable || !isFormValid}
          >
            {isForm ? 'Submit' : 'Open URL'}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
};
