/**
 * Trust Then Verify SDK
 * 
 * TypeScript SDK for the AI agent trust registry.
 * https://trustthenverify.com
 */

export interface TrustScore {
  total: number;
  confidence: number;
  tier: number;
  tier_label: string;
  badge: string;
  dimensions: {
    identity: { score: number; max: number };
    economic: { score: number; max: number };
    track_record: { score: number; max: number };
    social: { score: number; max: number };
    behavioral: { score: number; max: number };
  };
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  contact?: string;
  trust_score?: number;
  capabilities?: string[];
  lightning_pubkey?: string;
  nostr_npub?: string;
  x_handle?: string;
  website?: string;
  created_at?: string;
}

export interface RegisterResponse {
  agent_id: string;
  trust_score: number;
  badge: string;
  next_steps: Array<{ action: string; points: string }>;
}

export interface ReviewResponse {
  success: boolean;
  review_id?: string;
  error?: string;
}

export class TrustClient {
  private baseUrl: string;

  constructor(baseUrl: string = "https://trustthenverify.com") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /**
   * Look up an agent's trust score
   */
  async lookup(agentId: string): Promise<{ agent: Agent; trust_score: TrustScore } | null> {
    const res = await fetch(`${this.baseUrl}/registry/trust/${agentId}`);
    if (!res.ok) return null;
    return res.json();
  }

  /**
   * Get an agent by ID
   */
  async getAgent(agentId: string): Promise<Agent | null> {
    const res = await fetch(`${this.baseUrl}/registry/agent/${agentId}`);
    if (!res.ok) return null;
    return res.json();
  }

  /**
   * List all registered agents
   */
  async listAgents(): Promise<Agent[]> {
    const res = await fetch(`${this.baseUrl}/registry/agents`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.agents || [];
  }

  /**
   * Register a new agent
   */
  async register(
    name: string,
    contact: string,
    options?: {
      description?: string;
      capabilities?: string[];
      lightning_pubkey?: string;
      nostr_npub?: string;
      x_handle?: string;
      website?: string;
    }
  ): Promise<RegisterResponse> {
    const res = await fetch(`${this.baseUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, contact, ...options }),
    });
    return res.json();
  }

  /**
   * Submit a review for an agent
   */
  async review(
    agentId: string,
    rating: number,
    comment: string,
    options?: {
      reviewer_pubkey?: string;
      service_used?: string;
      proof_of_payment?: string;
    }
  ): Promise<ReviewResponse> {
    const res = await fetch(`${this.baseUrl}/registry/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: agentId,
        rating,
        comment,
        ...options,
      }),
    });
    return res.json();
  }

  /**
   * Get badge URL for embedding
   */
  badgeUrl(agentId: string): string {
    return `${this.baseUrl}/badge/${agentId}`;
  }

  /**
   * Check if an agent is trusted (score >= 60)
   */
  async isTrusted(agentId: string): Promise<boolean> {
    const result = await this.lookup(agentId);
    if (!result) return false;
    return result.trust_score.total >= 60;
  }

  /**
   * Get trust tier from score
   */
  static getTier(score: number): { label: string; badge: string; safe: boolean } {
    if (score >= 80) return { label: "Highly Trusted", badge: "🏆", safe: true };
    if (score >= 60) return { label: "Trusted", badge: "✅", safe: true };
    if (score >= 40) return { label: "Moderate", badge: "🔵", safe: false };
    if (score >= 20) return { label: "New/Limited", badge: "🟡", safe: false };
    return { label: "Unverified", badge: "⚪", safe: false };
  }
}

// Default client instance
export const trust = new TrustClient();

// Convenience functions
export const lookup = (agentId: string) => trust.lookup(agentId);
export const register = (name: string, contact: string, options?: Parameters<TrustClient["register"]>[2]) =>
  trust.register(name, contact, options);
export const review = (agentId: string, rating: number, comment: string, options?: Parameters<TrustClient["review"]>[3]) =>
  trust.review(agentId, rating, comment, options);
export const listAgents = () => trust.listAgents();
export const isTrusted = (agentId: string) => trust.isTrusted(agentId);
export const badgeUrl = (agentId: string) => trust.badgeUrl(agentId);

/**
 * Auto-register helper for agents
 * 
 * Ensures the calling agent is registered before making lookups.
 * Returns the agent ID for future reference.
 * 
 * @example
 * const myId = await ensureRegistered({
 *   name: "MyAgent",
 *   npub: process.env.MY_NPUB,
 *   lightning_pubkey: process.env.MY_LN_PUBKEY
 * });
 */
export async function ensureRegistered(options: {
  name: string;
  contact?: string;
  npub?: string;
  lightning_pubkey?: string;
  description?: string;
}): Promise<string> {
  // Check if already registered by name
  const agents = await trust.listAgents();
  const existing = agents.find(a => a.name.toLowerCase() === options.name.toLowerCase());
  
  if (existing) {
    return existing.id;
  }
  
  // Register new agent
  const result = await trust.register(
    options.name,
    options.contact || `sdk-auto-${Date.now()}`,
    {
      description: options.description,
      nostr_npub: options.npub,
      lightning_pubkey: options.lightning_pubkey,
    }
  );
  
  return result.agent_id;
}

/**
 * Check trust before transaction helper
 * 
 * Returns detailed recommendation for whether to proceed.
 * 
 * @example
 * const check = await checkBeforeTransaction("target-agent", 1000);
 * if (check.proceed) {
 *   await payAgent("target-agent", 1000);
 * } else {
 *   console.log("Risk:", check.reason);
 * }
 */
export async function checkBeforeTransaction(
  agentId: string,
  amountSats: number
): Promise<{
  proceed: boolean;
  score: number;
  reason: string;
  riskLevel: "low" | "medium" | "high" | "unknown";
}> {
  const result = await trust.lookup(agentId);
  
  if (!result) {
    return {
      proceed: false,
      score: 0,
      reason: "Agent not found in registry. Unverified counterparty.",
      riskLevel: "unknown",
    };
  }
  
  const score = result.trust_score.total;
  const tier = TrustClient.getTier(score);
  
  // High amounts require higher trust
  const requiredScore = amountSats > 10000 ? 60 : amountSats > 1000 ? 40 : 20;
  
  if (score >= requiredScore) {
    return {
      proceed: true,
      score,
      reason: `${tier.label} agent with score ${score}/100`,
      riskLevel: tier.safe ? "low" : "medium",
    };
  }
  
  return {
    proceed: false,
    score,
    reason: `Score ${score}/100 below threshold ${requiredScore} for ${amountSats} sats transaction`,
    riskLevel: score < 20 ? "high" : "medium",
  };
}
