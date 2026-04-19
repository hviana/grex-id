const handlerRegistry: Record<string, string[]> = {
  SEND_EMAIL: ["send_email"],
  SEND_SMS: ["send_sms"],
  PAYMENT_DUE: ["process_payment"],
  TRIGGER_AUTO_RECHARGE: ["auto_recharge"],
  PAYMENT_ASYNC_COMPLETED: ["resolve_async_payment"],
};

export function getHandlersForEvent(eventName: string): string[] {
  return handlerRegistry[eventName] ?? [];
}

export function registerEventHandler(eventName: string, handler: string): void {
  if (!handlerRegistry[eventName]) {
    handlerRegistry[eventName] = [];
  }
  if (!handlerRegistry[eventName].includes(handler)) {
    handlerRegistry[eventName].push(handler);
  }
}

export function getAllHandlerNames(): string[] {
  const names = new Set<string>();
  for (const handlers of Object.values(handlerRegistry)) {
    for (const h of handlers) {
      names.add(h);
    }
  }
  return [...names];
}
