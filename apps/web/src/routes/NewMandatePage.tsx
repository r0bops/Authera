import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import type { CreateMandateRequest } from '@authera/contracts';
import { useCreateMandate, useMe } from '../api/hooks.js';
import {
  Alert,
  Button,
  Card,
  FieldError,
  Input,
  KeyValue,
  Label,
  PageHeader,
  Select,
} from '../components/ui/primitives.js';
import { cn } from '../lib/cn.js';
import { AIRPORTS, airportLabel } from '../lib/airports.js';
import { endOfMonthIso, formatMoney, inputToMinor } from '../lib/format.js';

const FormSchema = z
  .object({
    origin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Three-letter airport code'),
    destination: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Three-letter airport code'),
    departureDateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
    departureDateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
    passengerCount: z.coerce.number().int().min(1).max(9),
    maxPerPurchase: z
      .string()
      .refine((v) => Number.isFinite(inputToMinor(v)) && inputToMinor(v) > 0, 'Enter an amount'),
    maxFulfillments: z.coerce.number().int().min(1).max(10),
    validUntil: z.string().min(1, 'Pick an expiry'),
    paymentMethodId: z.string().uuid('Choose a payment method'),
    /** Empty means every active merchant (the API default). */
    allowedMerchantIds: z.array(z.string().uuid()),
    escalate: z.boolean(),
  })
  .refine((v) => v.departureDateFrom <= v.departureDateTo, {
    message: 'The window must end after it starts',
    path: ['departureDateTo'],
  })
  .refine((v) => v.origin !== v.destination, {
    message: 'Origin and destination must differ',
    path: ['destination'],
  });
type FormInput = z.input<typeof FormSchema>;
type FormValues = z.output<typeof FormSchema>;

const STEPS = ['Trip', 'Conditions', 'Review & authorize'] as const;

export function NewMandatePage() {
  const me = useMe();
  const navigate = useNavigate();
  const create = useCreateMandate();
  const [step, setStep] = useState(0);
  const today = new Date();
  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(FormSchema),
    mode: 'onBlur',
    defaultValues: {
      origin: 'CCS',
      destination: 'COR',
      departureDateFrom: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1))
        .toISOString()
        .slice(0, 10),
      departureDateTo: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0))
        .toISOString()
        .slice(0, 10),
      passengerCount: 1,
      maxPerPurchase: '150.00',
      maxFulfillments: 1,
      validUntil: endOfMonthIso(today).slice(0, 16),
      paymentMethodId: '',
      allowedMerchantIds: [],
      escalate: false,
    },
  });
  const values = useWatch({ control: form.control }) as FormInput;
  const paymentMethods = me.data?.paymentMethods ?? [];
  const merchants = me.data?.merchants ?? [];
  const allowedMerchantIds = values.allowedMerchantIds ?? [];
  const allowedMerchants =
    allowedMerchantIds.length === 0
      ? merchants
      : merchants.filter((m) => allowedMerchantIds.includes(m.id));
  const toggleMerchant = (id: string, on: boolean) => {
    const current =
      allowedMerchantIds.length === 0 ? merchants.map((m) => m.id) : allowedMerchantIds;
    const next = on ? [...new Set([...current, id])] : current.filter((x) => x !== id);
    form.setValue('allowedMerchantIds', next, { shouldValidate: true });
  };
  const merchantLabel = (list: { displayName: string; market: string }[]) =>
    list.length === 0
      ? 'none'
      : list.length === merchants.length
        ? `any of ${list.map((m) => m.displayName).join(', ')}`
        : list.map((m) => `${m.displayName} (${m.market})`).join(', ');
  const defaultPaymentMethodId = paymentMethods[0]?.id;
  useEffect(() => {
    if (defaultPaymentMethodId && values.paymentMethodId === '') {
      form.setValue('paymentMethodId', defaultPaymentMethodId);
    }
  }, [defaultPaymentMethodId, form, values.paymentMethodId]);
  const maxMinor = inputToMinor(values.maxPerPurchase);
  const preview = Number.isFinite(maxMinor)
    ? `Buy ${values.passengerCount === 1 ? 'one' : values.passengerCount} economy flight${values.passengerCount === 1 ? '' : 's'} from ${airportLabel(values.origin)} to ${airportLabel(values.destination)}, leaving between ${values.departureDateFrom} and ${values.departureDateTo}, if the total is ${formatMoney({ currency: 'USD', minor: maxMinor })} or less — ${values.maxFulfillments === 1 ? 'a single purchase' : `up to ${values.maxFulfillments} purchases`}, until ${values.validUntil.replace('T', ' ')}. ${values.escalate ? 'Anything outside these limits pauses and asks you first.' : 'Anything outside these limits is blocked.'}`
    : 'Set a maximum price to see the preview.';

  const next = async () => {
    const fields: Array<keyof FormValues> =
      step === 0
        ? ['origin', 'destination', 'departureDateFrom', 'departureDateTo', 'passengerCount']
        : ['maxPerPurchase', 'maxFulfillments', 'validUntil', 'paymentMethodId'];
    if (step === 1 && allowedMerchants.length === 0) {
      form.setError('allowedMerchantIds', { message: 'Allow at least one merchant' });
      return;
    }
    if (await form.trigger(fields)) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const submit = form.handleSubmit(async (v) => {
    const minor = inputToMinor(v.maxPerPurchase);
    const request: CreateMandateRequest = {
      paymentMethodId: v.paymentMethodId,
      ...(v.allowedMerchantIds.length > 0 && v.allowedMerchantIds.length < merchants.length
        ? { allowedMerchantIds: v.allowedMerchantIds }
        : {}),
      intent: {
        type: 'flight',
        origin: v.origin,
        destination: v.destination,
        cabin: 'economy',
        departureDateFrom: v.departureDateFrom,
        departureDateTo: v.departureDateTo,
        passengerCount: v.passengerCount,
      },
      limits: {
        currency: 'USD',
        maxPerPurchaseMinor: minor,
        maxTotalMinor: minor * v.maxFulfillments,
        maxFulfillments: v.maxFulfillments,
      },
      validUntil: new Date(v.validUntil).toISOString(),
      escalation: v.escalate ? 'require_human' : 'block',
    };
    const created = await create.mutateAsync(request);
    void navigate(`/dashboard/mandates/${created.id}`);
  });

  return (
    <>
      <PageHeader
        title="Create purchase mandate"
        description="A mandate is a signed, bounded authorization. Your agent can only buy what it describes — never more."
      />
      <ol className="mb-4 flex items-center gap-2 text-[12.5px]">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold',
                i <= step ? 'bg-cobalt text-white' : 'bg-surface-muted text-ink-faint',
              )}
            >
              {i + 1}
            </span>
            <span className={cn(i === step ? 'font-semibold text-ink' : 'text-ink-muted')}>
              {label}
            </span>
            {i < STEPS.length - 1 ? (
              <span className="mx-1 h-px w-8 bg-line-strong" aria-hidden />
            ) : null}
          </li>
        ))}
      </ol>
      <form onSubmit={submit} className="grid grid-cols-12 gap-4">
        <div className="col-span-8">
          {step === 0 ? (
            <Card
              title="Where and when"
              description="Describe the trip the way you would to a travel agent."
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="origin">Flying from</Label>
                  <Select id="origin" {...form.register('origin')}>
                    {AIRPORTS.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.city}, {a.country} ({a.code})
                      </option>
                    ))}
                  </Select>
                  <FieldError message={form.formState.errors.origin?.message} />
                </div>
                <div>
                  <Label htmlFor="destination">Flying to</Label>
                  <Select id="destination" {...form.register('destination')}>
                    {AIRPORTS.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.city}, {a.country} ({a.code})
                      </option>
                    ))}
                  </Select>
                  <FieldError message={form.formState.errors.destination?.message} />
                </div>
                <div>
                  <Label htmlFor="from">Leave no earlier than</Label>
                  <Input id="from" type="date" {...form.register('departureDateFrom')} />
                  <FieldError message={form.formState.errors.departureDateFrom?.message} />
                </div>
                <div>
                  <Label htmlFor="to">Leave no later than</Label>
                  <Input id="to" type="date" {...form.register('departureDateTo')} />
                  <FieldError message={form.formState.errors.departureDateTo?.message} />
                </div>
                <div>
                  <Label htmlFor="pax">Travellers</Label>
                  <Input
                    id="pax"
                    type="number"
                    min={1}
                    max={9}
                    {...form.register('passengerCount')}
                  />
                  <FieldError message={form.formState.errors.passengerCount?.message} />
                </div>
                <div>
                  <Label>Cabin</Label>
                  <Input value="Economy" disabled readOnly />
                </div>
              </div>
            </Card>
          ) : null}
          {step === 1 ? (
            <Card
              title="How much, how often, until when"
              description="These are hard limits. The agent cannot exceed any of them, and the gateway checks every purchase against them."
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="max" hint="USD, total per ticket">
                    Spend up to
                  </Label>
                  <Input
                    id="max"
                    inputMode="decimal"
                    placeholder="150.00"
                    {...form.register('maxPerPurchase')}
                  />
                  <FieldError message={form.formState.errors.maxPerPurchase?.message} />
                </div>
                <div>
                  <Label htmlFor="uses" hint="how many times it may buy">
                    Number of purchases
                  </Label>
                  <Input
                    id="uses"
                    type="number"
                    min={1}
                    max={10}
                    {...form.register('maxFulfillments')}
                  />
                  <FieldError message={form.formState.errors.maxFulfillments?.message} />
                </div>
                <div>
                  <Label htmlFor="until">Authorization ends</Label>
                  <Input id="until" type="datetime-local" {...form.register('validUntil')} />
                  <FieldError message={form.formState.errors.validUntil?.message} />
                </div>
                <div>
                  <Label htmlFor="pm">Pay with</Label>
                  <Select id="pm" {...form.register('paymentMethodId')}>
                    {paymentMethods.map((pm) => (
                      <option key={pm.id} value={pm.id}>
                        {pm.brand} •••• {pm.last4}
                      </option>
                    ))}
                  </Select>
                  <FieldError message={form.formState.errors.paymentMethodId?.message} />
                </div>
                <div className="col-span-2">
                  <Label>Where it may buy</Label>
                  {merchants.length <= 1 ? (
                    <p className="text-[13px] text-ink">
                      {merchants[0]?.displayName ?? 'The connected flight market'}{' '}
                      <span className="text-ink-faint">
                        — every offer comes from this live market.
                      </span>
                    </p>
                  ) : (
                    <>
                      <p className="mb-1.5 text-[12px] text-ink-faint">
                        The agent searches all of them; untick one and the gateway blocks any
                        purchase from it.
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {merchants.map((m) => {
                          const on = allowedMerchants.some((a) => a.id === m.id);
                          return (
                            <label key={m.id} className="flex items-center gap-1.5 text-[13px]">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={(e) => toggleMerchant(m.id, e.target.checked)}
                              />
                              {m.displayName}
                            </label>
                          );
                        })}
                      </div>
                    </>
                  )}
                  <FieldError message={form.formState.errors.allowedMerchantIds?.message} />
                </div>
                <fieldset className="col-span-2">
                  <legend className="mb-1.5 text-[12.5px] font-medium text-ink">
                    If the agent finds a flight outside these limits
                  </legend>
                  <div className="grid grid-cols-2 gap-3">
                    {(
                      [
                        {
                          value: false,
                          title: 'Block it',
                          hint: 'Nothing happens. You see the blocked attempt in your activity.',
                        },
                        {
                          value: true,
                          title: 'Pause and ask me',
                          hint: 'The purchase waits for your one-time approval of that exact offer.',
                        },
                      ] as const
                    ).map((opt) => (
                      <label
                        key={String(opt.value)}
                        className={cn(
                          'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px]',
                          values.escalate === opt.value
                            ? 'border-cobalt bg-cobalt-soft/40'
                            : 'border-line hover:border-line-strong',
                        )}
                      >
                        <input
                          type="radio"
                          name="escalate"
                          className="mt-0.5"
                          checked={values.escalate === opt.value}
                          onChange={() => form.setValue('escalate', opt.value)}
                        />
                        <span>
                          <span className="block font-medium text-ink">{opt.title}</span>
                          <span className="block text-[12px] text-ink-muted">{opt.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </Card>
          ) : null}
          {step === 2 ? (
            <Card
              title="Authorization summary"
              description="This is what you are signing. The agent can do exactly this, and nothing else."
            >
              <KeyValue
                items={[
                  {
                    label: 'Agent',
                    value: (
                      <span>
                        {me.data?.agents[0]?.displayName ?? 'Purchasing agent'}{' '}
                        <span className="font-mono text-[11.5px] text-ink-faint">
                          {me.data?.agents[0]?.keyThumbprint?.slice(0, 16) ?? ''}…
                        </span>
                      </span>
                    ),
                  },
                  {
                    label: 'Trip',
                    value: `${airportLabel(values.origin)} → ${airportLabel(values.destination)}, ${values.passengerCount} traveller${values.passengerCount === 1 ? '' : 's'}, economy`,
                  },
                  {
                    label: 'Leaving between',
                    value: `${values.departureDateFrom} → ${values.departureDateTo}`,
                  },
                  {
                    label: 'Spend up to',
                    value: (
                      <span className="font-semibold">
                        {Number.isFinite(maxMinor)
                          ? formatMoney({ currency: 'USD', minor: maxMinor })
                          : '—'}
                      </span>
                    ),
                  },
                  {
                    label: 'May buy',
                    value:
                      values.maxFulfillments === 1
                        ? 'once'
                        : `up to ${values.maxFulfillments} times`,
                  },
                  { label: 'Where', value: merchantLabel(allowedMerchants) },
                  { label: 'Authorization ends', value: values.validUntil.replace('T', ' ') },
                  {
                    label: 'Payment',
                    value: paymentMethods.find((pm) => pm.id === values.paymentMethodId)
                      ? `${paymentMethods.find((pm) => pm.id === values.paymentMethodId)?.brand} •••• ${paymentMethods.find((pm) => pm.id === values.paymentMethodId)?.last4}`
                      : '—',
                  },
                  {
                    label: 'Outside the limits',
                    value: values.escalate ? 'Pause and ask me' : 'Block it',
                  },
                ]}
              />
              <details className="mt-3 rounded-md border border-line px-3 py-2 text-[13px]">
                <summary className="font-medium">What your agent can do</summary>
                <p className="mt-1 text-ink-muted">
                  Search every connected market for flights on this route, prepare a checkout for an
                  eligible offer, and request the purchase through the gateway using your tokenized
                  payment method.
                </p>
              </details>
              <details className="mt-2 rounded-md border border-line px-3 py-2 text-[13px]">
                <summary className="font-medium">What it cannot do</summary>
                <p className="mt-1 text-ink-muted">
                  Spend above the limit, buy a different route or cabin, buy after expiry, buy more
                  than the permitted count, change the cart after authorization, or reach the
                  payment processor on its own.
                </p>
              </details>
              {create.isError ? (
                <div className="mt-3">
                  <Alert tone="destructive" title="Could not create the mandate">
                    {create.error.message}
                  </Alert>
                </div>
              ) : null}
            </Card>
          ) : null}
          <div className="mt-4 flex items-center justify-between">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  void next();
                }}
              >
                Continue
              </Button>
            ) : (
              <Button type="submit" loading={create.isPending}>
                Authorize mandate
              </Button>
            )}
          </div>
        </div>
        <aside className="col-span-4">
          <Card title="Mandate preview" className="sticky top-5">
            <p className="text-[13.5px] leading-relaxed text-ink">{preview}</p>
            <p className="mt-3 text-[12px] text-ink-faint">
              Signed by the trusted surface with an Ed25519 key and bound to your agent’s key.
              Revocable at any time.
            </p>
          </Card>
        </aside>
      </form>
    </>
  );
}
