import type { Endpoint } from '@mozaik-ai/core';

type MutableItem = {
  type?: string;
  name?: unknown;
  callId?: unknown;
  thoughtSignature?: string;
};

export function patchGeminiFunctionCalling(endpoint: Endpoint): void {
  const mapper = endpoint.endpointMapper;
  const originalToRequest = mapper.toRequest.bind(mapper);
  const originalToResponse = mapper.toResponse.bind(mapper);

  mapper.toResponse = (response: any) => {
    const parts = response?.candidates?.[0]?.content?.parts ?? [];
    const signatures = parts
      .filter((part: any) => Boolean(part.functionCall))
      .map((part: any) => part.thoughtSignature)
      .filter(Boolean);

    const output = originalToResponse(response);
    let index = 0;
    for (const item of output.items as MutableItem[]) {
      if (item.type !== 'function_call') continue;

      const signature = signatures[index++];
      if (signature) item.thoughtSignature = signature;
      if (typeof item.name === 'string' && item.name.includes(':')) {
        item.name = item.name.slice(item.name.lastIndexOf(':') + 1);
      }
    }
    return output;
  };

  mapper.toRequest = (input: any) => {
    const request = originalToRequest(input);
    const calls = (input.context.getItems() as MutableItem[]).filter(
      (item) => item.type === 'function_call',
    );

    let index = 0;
    for (const content of request.contents ?? []) {
      for (const part of content.parts ?? []) {
        if (!part.functionCall) continue;

        const signature = calls[index++]?.thoughtSignature;
        if (signature) part.thoughtSignature = signature;
      }
    }
    return request;
  };
}
