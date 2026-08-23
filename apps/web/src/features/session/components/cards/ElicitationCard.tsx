import React, { useState } from 'react';
import type { ElicitationItem, ElicitationResponse } from '@agentctl/shared';
import { Card, CardHeader, CardContent, CardFooter, Button, Input, Select } from '@agentctl/ui';

export interface ElicitationCardProps {
  elicitation: ElicitationItem;
  onRespond?: (elicitationId: string, response: ElicitationResponse) => void;
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

  const [formValues, setFormValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    if (request.form?.fields) {
      for (const field of request.form.fields) {
        if (field.default !== undefined) {
          initial[field.id] = field.default;
        } else if (field.type === 'boolean') {
          initial[field.id] = false;
        } else {
          initial[field.id] = '';
        }
      }
    }
    return initial;
  });

  const isPending = status === 'pending';

  const cardStatus =
    status === 'completed' ? 'success' : status === 'cancelled' ? 'error' : 'pending';

  const handleInputChange = (fieldId: string, val: unknown) => {
    setFormValues((prev) => ({
      ...prev,
      [fieldId]: val,
    }));
  };

  const handleSubmit = (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    if (!isPending || !onRespond || disabled) return;
    onRespond(elicitation.id, {
      action: 'submit',
      values: isForm ? formValues : undefined,
    });
  };

  const handleCancel = () => {
    if (!isPending || !onRespond || disabled) return;
    onRespond(elicitation.id, {
      action: 'cancel',
    });
  };

  return (
    <Card status={cardStatus} className="my-3 shadow-lg backdrop-blur-md">
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="bg-accent/20 text-accent rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase">
            {isForm ? 'Form Request' : 'External Authorization'}
          </span>
          <span className="text-text-muted font-mono text-xs">ID: {elicitation.id}</span>
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
        {isForm && request.form && (
          <form onSubmit={handleSubmit} className="space-y-3">
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
                      htmlFor={`elicitation-${field.id}`}
                      className="text-text-muted text-[11px] font-semibold"
                    >
                      {field.label}
                      {field.required && <span className="ml-1 text-rose-400">*</span>}
                    </label>
                  )}

                  {field.type === 'select' ? (
                    <Select
                      id={`elicitation-${field.id}`}
                      value={
                        typeof formValues[field.id] === 'string'
                          ? (formValues[field.id] as string)
                          : ''
                      }
                      disabled={!isPending || disabled}
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
                  ) : field.type === 'boolean' ? (
                    <label className="text-text-muted flex cursor-pointer items-center gap-2 text-[11px] font-semibold">
                      <input
                        type="checkbox"
                        checked={Boolean(formValues[field.id])}
                        disabled={!isPending || disabled}
                        onChange={(e) => {
                          handleInputChange(field.id, e.target.checked);
                        }}
                        className="border-border bg-surface text-accent focus:ring-accent/20 rounded"
                      />
                      <span>Enable {field.label}</span>
                    </label>
                  ) : (
                    <Input
                      id={`elicitation-${field.id}`}
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={
                        typeof formValues[field.id] === 'string' ||
                        typeof formValues[field.id] === 'number'
                          ? String(formValues[field.id])
                          : ''
                      }
                      disabled={!isPending || disabled}
                      onChange={(e) => {
                        handleInputChange(
                          field.id,
                          field.type === 'number' ? Number(e.target.value) : e.target.value,
                        );
                      }}
                      placeholder={`Enter ${field.label.toLowerCase()}...`}
                    />
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

            <div className="bg-surface/50 border-border/40 flex items-center justify-between gap-2 rounded-lg border p-2.5">
              <span className="text-text-muted truncate font-mono text-[11px]">
                {request.url.url}
              </span>
              <a
                href={request.url.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0"
              >
                <Button variant="outline" size="sm">
                  Open URL ↗
                </Button>
              </a>
            </div>
          </div>
        )}
      </CardContent>

      {isPending && (
        <CardFooter className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleCancel} disabled={disabled}>
            Cancel
          </Button>
          <Button
            variant="solid"
            size="sm"
            onClick={() => {
              handleSubmit();
            }}
            disabled={disabled}
          >
            {isForm ? 'Submit' : 'Mark Completed'}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
};
