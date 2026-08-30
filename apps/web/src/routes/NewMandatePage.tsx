import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import type { CreateMandateRequest } from '@authera/contracts';
import { useCreateMandate, useMe } from '../api/hooks.js';
import {
  Alert,
  Badge,
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
import { endOfMonthIso, formatMoney, friendlyAgentName, inputToMinor } from '../lib/format.js';

const FormSchema = z
  .object({
    category: z.enum(['flight', 'goods']),
    query: z.string().trim().max(80),
    maxQuantity: z.coerce.number().int().min(1).max(10),
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
    dateFlexibilityDays: z.coerce.number().int().min(0).max(30),
    passengerCount: z.coerce.number().int().min(1).max(9),
    maxPerPurchase: z
      .string()
      .refine((v) => Number.isFinite(inputToMinor(v)) && inputToMinor(v) > 0, 'Enter an amount'),
    maxFulfillments: z.coerce.number().int().min(1).max(10),
    validUntil: z.string().min(1, 'Pick an expiry'),
    paymentMethodId: z.string().uuid('Choose a payment method'),
    allowedMerchantIds: z.array(z.string().uuid()),
  })
  .refine((v) => v.category !== 'flight' || v.departureDateFrom <= v.departureDateTo, {
    message: 'The window must end after it starts',
    path: ['departureDateTo'],
  })
  .refine((v) => v.category !== 'flight' || v.origin !== v.destination, {
    message: 'Origin and destination must differ',
    path: ['destination'],
  })
  .refine((v) => v.category !== 'goods' || v.query.length >= 2, {
    message: 'Describe what to buy',
    path: ['query'],
  });
type FormInput = z.input<typeof FormSchema>;
type FormValues = z.output<typeof FormSchema>;

const STEPS = ['What you need', 'Your rules', 'Review'] as const;

const CATEGORIES = [
  { value: 'flight', title: 'Flight', hint: 'A ticket on a route, within a travel window' },
  { value: 'goods', title: 'Product', hint: 'An item from a connected store' },
] as const;

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
      category: 'flight',
      query: '',
      maxQuantity: 1,
      origin: 'CCS',
      destination: 'COR',
      departureDateFrom: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1))
        .toISOString()
        .slice(0, 10),
      departureDateTo: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0))
        .toISOString()
        .slice(0, 10),
      dateFlexibilityDays: 3,
      passengerCount: 1,
      maxPerPurchase: '150.00',
      maxFulfillments: 1,
      validUntil: endOfMonthIso(today).slice(0, 16),
      paymentMethodId: '',
      allowedMerchantIds: [],
    },
  });
  const values = useWatch({ control: form.control }) as FormInput;
  const paymentMethods = me.data?.paymentMethods ?? [];
  const agentName = friendlyAgentName(me.data?.agents[0]?.displayName);
  const allMerchants = me.data?.merchants ?? [];
  const merchants = allMerchants.filter((m) =>
    values.category === 'goods' ? m.slug !== 'duffel' : m.slug === 'duffel',
  );
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
  useEffect(() => {
    form.setValue('allowedMerchantIds', []);
  }, [form, values.category]);
  const maxMinor = inputToMinor(values.maxPerPurchase);
  const flexibilityDays = Number(values.dateFlexibilityDays);
  const flexibilityText =
    flexibilityDays === 0
      ? 'on those exact dates'
      : `with ${flexibilityDays} day${flexibilityDays === 1 ? '' : 's'} of flexibility before or after`;
  const previewTail = Number.isFinite(maxMinor)
    ? `if the total is ${formatMoney({ currency: 'USD', minor: maxMinor })} or less — ${values.maxFulfillments === 1 ? 'a single purchase' : `up to ${values.maxFulfillments} purchases`}, until ${values.validUntil.replace('T', ' ')}. Anything outside these limits is blocked.`
    : null;
  const preview = !previewTail
    ? 'Set a maximum price to see the preview.'
    : values.category === 'goods'
      ? `Buy “${values.query || '···'}” (${Number(values.maxQuantity) === 1 ? 'one unit' : `up to ${values.maxQuantity} units`}) from a connected store, ${previewTail}`
      : `Buy ${values.passengerCount === 1 ? 'one' : values.passengerCount} economy flight${values.passengerCount === 1 ? '' : 's'} from ${airportLabel(values.origin)} to ${airportLabel(values.destination)}, leaving between ${values.departureDateFrom} and ${values.departureDateTo}, ${flexibilityText}, ${previewTail}`;

  const next = async () => {
    const fields: Array<keyof FormValues> =
      step === 0
        ? values.category === 'goods'
          ? ['query', 'maxQuantity']
          : ['origin', 'destination', 'departureDateFrom', 'departureDateTo', 'passengerCount']
        : [
            'maxPerPurchase',
            'maxFulfillments',
            'validUntil',
            'paymentMethodId',
            ...(values.category === 'flight' ? (['dateFlexibilityDays'] as const) : []),
          ];
    if (step === 1 && allowedMerchants.length === 0) {
      form.setError('allowedMerchantIds', { message: 'Allow at least one merchant' });
      return;
    }
    if (await form.trigger(fields)) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const submit = form.handleSubmit(async (v) => {
    const minor = inputToMinor(v.maxPerPurchase);
    const intent: CreateMandateRequest['intent'] =
      v.category === 'goods'
        ? { type: 'goods', query: v.query, maxQuantity: v.maxQuantity }
        : {
            type: 'flight',
            origin: v.origin,
            destination: v.destination,
            cabin: 'economy',
            departureDateFrom: v.departureDateFrom,
            departureDateTo: v.departureDateTo,
            dateFlexibilityDays: v.dateFlexibilityDays,
            passengerCount: v.passengerCount,
          };
    const request: CreateMandateRequest = {
      paymentMethodId: v.paymentMethodId,
      // Always explicit: a product mandate must not be able to buy from the flight market.
      ...(allowedMerchants.length > 0
        ? { allowedMerchantIds: allowedMerchants.map((m) => m.id) }
        : {}),
      intent,
      limits: {
        currency: 'USD',
        maxPerPurchaseMinor: minor,
        maxTotalMinor: minor * v.maxFulfillments,
        maxFulfillments: v.maxFulfillments,
      },
      validUntil: new Date(v.validUntil).toISOString(),
      escalation: 'block',
    };
    const created = await create.mutateAsync(request);
    void navigate(`/dashboard/mandates/${created.id}`);
  });

  return (
    <>
      <PageHeader
        title="Plan a purchase"
        description={`Describe what you need once. ${agentName} will search and can only buy inside the rules you approve.`}
      />
      <ol className="mb-4 grid grid-cols-3 gap-2 text-[12px] sm:flex sm:items-center sm:text-[12.5px]">
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
              <span className="mx-1 hidden h-px w-8 bg-line-strong sm:block" aria-hidden />
            ) : null}
          </li>
        ))}
      </ol>
      <form onSubmit={submit} className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          {step === 0 ? (
            <Card
              title={values.category === 'goods' ? 'What to buy' : 'Where and when'}
              description={
                values.category === 'goods'
                  ? 'Describe the product the way you would to a personal shopper.'
                  : 'Describe the trip the way you would to a travel agent.'
              }
            >
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                {CATEGORIES.map((c) => (
                  <label
                    key={c.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px]',
                      values.category === c.value
                        ? 'border-cobalt bg-cobalt-soft/40'
                        : 'border-line hover:border-line-strong',
                    )}
                  >
                    <input
                      type="radio"
                      name="category"
                      className="mt-0.5 h-5 w-5 shrink-0 accent-cobalt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt"
                      checked={values.category === c.value}
                      onChange={() => form.setValue('category', c.value)}
                    />
                    <span>
                      <span className="block font-medium text-ink">{c.title}</span>
                      <span className="block text-[12px] text-ink-muted">{c.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              {values.category === 'goods' ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Label htmlFor="query" hint="as you would type it into a store search">
                      What should it buy?
                    </Label>
                    <Input id="query" placeholder="wool runner" {...form.register('query')} />
                    <FieldError message={form.formState.errors.query?.message} />
                  </div>
                  <div>
                    <Label htmlFor="qty">Up to how many?</Label>
                    <Input
                      id="qty"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      {...form.register('maxQuantity')}
                    />
                    <FieldError message={form.formState.errors.maxQuantity?.message} />
                  </div>
                </div>
              ) : null}
              <div
                className={cn(
                  'grid gap-4 sm:grid-cols-2',
                  values.category !== 'flight' && 'hidden',
                )}
              >
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
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
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
              description="Authera checks every one of these rules before any payment. Anything outside them is stopped."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="max" hint="USD, total per purchase">
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
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
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
                <div className="sm:col-span-2">
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
                        Aria searches all of them. Deselect a provider to prevent purchases from it.
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {merchants.map((m) => {
                          const on = allowedMerchants.some((a) => a.id === m.id);
                          return (
                            <label
                              key={m.id}
                              className="flex min-h-11 items-center gap-2 text-[13px] md:min-h-10"
                            >
                              <input
                                type="checkbox"
                                className="h-5 w-5 shrink-0 accent-cobalt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt"
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
                {values.category === 'flight' ? (
                  <div className="sm:col-span-2">
                    <Label htmlFor="dateFlexibility" hint="0–30 days">
                      Search date tolerance
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="dateFlexibility"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className="max-w-24"
                        {...form.register('dateFlexibilityDays')}
                      />
                      <span className="text-[13px] text-ink-muted">
                        day{flexibilityDays === 1 ? '' : 's'} before or after
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] text-ink-muted">
                      {flexibilityDays === 0
                        ? 'Aria searches only the preferred travel dates above.'
                        : `Aria may search and buy flights up to ${flexibilityDays} day${flexibilityDays === 1 ? '' : 's'} before or after your preferred window.`}
                    </p>
                    <FieldError message={form.formState.errors.dateFlexibilityDays?.message} />
                  </div>
                ) : (
                  <p className="sm:col-span-2 text-[12px] text-ink-muted">
                    Products outside these rules are blocked and recorded in your activity.
                  </p>
                )}
              </div>
            </Card>
          ) : null}
          {step === 2 ? (
            <Card
              title="Review your plan"
              description="Read this once before Aria starts. It can do exactly this and nothing more."
            >
              <KeyValue
                items={[
                  {
                    label: 'Agent',
                    value: (
                      <span className="inline-flex items-center gap-2">
                        {agentName}
                        <Badge tone="verified">Verified</Badge>
                      </span>
                    ),
                  },
                  ...(values.category === 'goods'
                    ? [
                        { label: 'Product', value: `“${values.query}”` },
                        {
                          label: 'Quantity',
                          value:
                            Number(values.maxQuantity) === 1
                              ? 'one unit'
                              : `up to ${values.maxQuantity} units`,
                        },
                      ]
                    : [
                        {
                          label: 'Trip',
                          value: `${airportLabel(values.origin)} → ${airportLabel(values.destination)}, ${values.passengerCount} traveller${values.passengerCount === 1 ? '' : 's'}, economy`,
                        },
                        {
                          label: 'Leaving between',
                          value: `${values.departureDateFrom} → ${values.departureDateTo}`,
                        },
                        {
                          label: 'Date flexibility',
                          value:
                            flexibilityDays === 0
                              ? 'Exact dates only'
                              : `± ${flexibilityDays} day${flexibilityDays === 1 ? '' : 's'}`,
                        },
                      ]),
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
                    value: 'Block it',
                  },
                ]}
              />
              <details className="mt-3 rounded-md border border-line px-3 py-2 text-[13px]">
                <summary className="font-medium">What your agent can do</summary>
                <p className="mt-1 text-ink-muted">
                  {values.category === 'goods'
                    ? 'Search connected stores for this product, compare eligible offers, and request one using your saved payment method.'
                    : 'Search connected flight providers for this route, compare eligible offers, and request one using your saved payment method.'}
                </p>
              </details>
              <details className="mt-2 rounded-md border border-line px-3 py-2 text-[13px]">
                <summary className="font-medium">What it cannot do</summary>
                <p className="mt-1 text-ink-muted">
                  {values.category === 'goods'
                    ? 'Spend above your limit, buy a different product, exceed the quantity, buy after expiry, or change the checkout after you approve it.'
                    : 'Spend above your limit, buy a different route or cabin, buy after expiry, or change the checkout after you approve it.'}
                </p>
              </details>
              {create.isError ? (
                <div className="mt-3">
                  <Alert tone="destructive" title="Could not start this plan">
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
                Authorize and start
              </Button>
            )}
          </div>
        </div>
        <aside className="lg:col-span-4">
          <Card title="Your plan" className="lg:sticky lg:top-5">
            <p className="text-[13.5px] leading-relaxed text-ink">{preview}</p>
            <p className="mt-3 text-[12px] text-ink-muted">
              Nothing is charged when you create this plan. You can change or stop it at any time.
            </p>
            <details className="mt-3 border-t border-line pt-3 text-[12px]">
              <summary className="min-h-11 font-medium text-cobalt md:min-h-10">
                Proof & details
              </summary>
              <p className="mt-1 text-ink-muted">
                Authera signs this authorization and binds it to {agentName}’s verified key. Every
                later purchase is checked against the signed rules and current revocation state.
              </p>
            </details>
          </Card>
        </aside>
      </form>
    </>
  );
}
