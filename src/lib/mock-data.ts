export interface Provider {
  id: string;
  name: string;
  email: string;
  type: 'google' | 'microsoft';
  connected: boolean;
  connectedAt: string;
}

export interface Draft {
  id: string;
  subject: string;
  recipient: string;
  body: string;
  confidence: number;
  category: string;
  createdAt: string;
}

export interface KbItem {
  id: string;
  type: string;
  title: string;
  content: string;
  confidence: number;
  verified: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  model: string;
  confidence: number;
  kbItemsReferenced: string[];
  decisionType: 'classify' | 'draft' | 'send';
  emailSubject: string;
}

export interface AutomationRule {
  id: string;
  category: string;
  enabled: boolean;
  confidenceThreshold: number;
}

export const MOCK_PROVIDERS: Provider[] = [
  { id: 'p1', name: 'Google', email: 'alice@gmail.com', type: 'google', connected: true, connectedAt: '2026-04-15T10:30:00Z' },
  { id: 'p2', name: 'Microsoft', email: 'alice@outlook.com', type: 'microsoft', connected: true, connectedAt: '2026-04-16T14:00:00Z' },
];

export const MOCK_DRAFTS: Draft[] = [
  { id: 'd1', subject: 'Re: Q4 budget review', recipient: 'alice@example.com', body: 'I have reviewed the Q4 projections and they look good. A few minor adjustments needed on the marketing line items. Please update and resend.', confidence: 0.94, category: 'invoice', createdAt: '2026-05-09T08:00:00Z' },
  { id: 'd2', subject: 'Re: Need help with account setup', recipient: 'bob@customer.org', body: 'Thank you for reaching out. I have reset your account and sent a new activation link to your registered email. Please check your inbox and follow the instructions.', confidence: 0.88, category: 'support', createdAt: '2026-05-09T07:30:00Z' },
  { id: 'd3', subject: 'Re: Meeting tomorrow at 3pm', recipient: 'carol@partner.io', body: 'Confirmed. I will prepare the agenda and send it out an hour before the meeting. Looking forward to discussing the partnership proposal.', confidence: 0.82, category: 'meeting', createdAt: '2026-05-09T07:00:00Z' },
  { id: 'd4', subject: 'Re: Monthly investor update', recipient: 'dave@investor.fund', body: 'Please find attached the detailed breakdown of our monthly metrics. Revenue grew 12% MoM and we are on track for Q3 targets.', confidence: 0.76, category: 'investor', createdAt: '2026-05-09T06:00:00Z' },
];

export const MOCK_KB_ITEMS: KbItem[] = [
  { id: 'k1', type: 'faq', title: 'How to reset password', content: 'Users can reset their password by clicking "Forgot password" on the login page.', confidence: 0.95, verified: true, createdAt: '2026-05-08T10:00:00Z' },
  { id: 'k2', type: 'policy', title: 'Refund policy', content: 'Refunds are processed within 14 business days for eligible purchases.', confidence: 0.91, verified: true, createdAt: '2026-05-08T09:00:00Z' },
  { id: 'k3', type: 'pricing', title: 'Pro tier pricing', content: 'Pro tier costs £299/month and includes unlimited team members and priority support.', confidence: 0.89, verified: true, createdAt: '2026-05-08T08:00:00Z' },
  { id: 'k4', type: 'preference', title: 'Notification preferences', content: 'Customer prefers email notifications for billing but Slack for support updates.', confidence: 0.85, verified: true, createdAt: '2026-05-07T16:00:00Z' },
  { id: 'k5', type: 'contact', title: 'CEO contact', content: 'CEO: Jane Smith, jane@company.com, +44 20 7123 4567', confidence: 0.93, verified: true, createdAt: '2026-05-07T15:00:00Z' },
  { id: 'k6', type: 'signature', title: 'Standard email signature', content: 'Best regards,\nAlice Johnson\nSupport Team\nTaskResponse Inc.', confidence: 0.90, verified: true, createdAt: '2026-05-07T14:00:00Z' },
  { id: 'k7', type: 'tone-sample', title: 'Professional tone', content: 'We appreciate your business and are committed to providing the best possible service.', confidence: 0.87, verified: true, createdAt: '2026-05-07T13:00:00Z' },
  { id: 'k8', type: 'faq', title: 'Cancellation process', content: 'Customers can cancel anytime from Settings > Billing. No questions asked.', confidence: 0.72, verified: false, createdAt: '2026-05-09T05:00:00Z' },
  { id: 'k9', type: 'pricing', title: 'Enterprise pricing', content: 'Enterprise plans start at £999/month with custom SLAs and dedicated support.', confidence: 0.68, verified: false, createdAt: '2026-05-09T04:00:00Z' },
];

export const MOCK_AUDIT_LOG: AuditEntry[] = [
  { id: 'a1', timestamp: '2026-05-09T08:30:00Z', model: 'DeepSeek V4 Pro', confidence: 0.94, kbItemsReferenced: ['k1', 'k3'], decisionType: 'send', emailSubject: 'Re: Q4 budget review' },
  { id: 'a2', timestamp: '2026-05-09T08:00:00Z', model: 'DeepSeek V4 Pro', confidence: 0.88, kbItemsReferenced: ['k2'], decisionType: 'draft', emailSubject: 'Re: Need help with account setup' },
  { id: 'a3', timestamp: '2026-05-09T07:30:00Z', model: 'DeepSeek V4 Pro', confidence: 0.92, kbItemsReferenced: ['k5'], decisionType: 'classify', emailSubject: 'URGENT: Server outage' },
  { id: 'a4', timestamp: '2026-05-09T07:00:00Z', model: 'DeepSeek V4 Pro', confidence: 0.85, kbItemsReferenced: ['k6'], decisionType: 'send', emailSubject: 'Re: Contract renewal dispute' },
  { id: 'a5', timestamp: '2026-05-09T06:30:00Z', model: 'DeepSeek V4 Pro', confidence: 0.79, kbItemsReferenced: ['k4', 'k7'], decisionType: 'draft', emailSubject: 'Re: Interested in your product' },
  { id: 'a6', timestamp: '2026-05-09T06:00:00Z', model: 'DeepSeek V4 Pro', confidence: 0.91, kbItemsReferenced: ['k3'], decisionType: 'classify', emailSubject: 'Monthly investor update' },
];

export const MOCK_AUTOMATION_RULES: AutomationRule[] = [
  { id: 'r1', category: 'sales', enabled: true, confidenceThreshold: 0.90 },
  { id: 'r2', category: 'support', enabled: true, confidenceThreshold: 0.85 },
  { id: 'r3', category: 'invoice', enabled: true, confidenceThreshold: 0.88 },
  { id: 'r4', category: 'complaint', enabled: false, confidenceThreshold: 0.95 },
  { id: 'r5', category: 'meeting', enabled: true, confidenceThreshold: 0.85 },
  { id: 'r6', category: 'investor', enabled: false, confidenceThreshold: 0.90 },
  { id: 'r7', category: 'urgent', enabled: true, confidenceThreshold: 0.85 },
  { id: 'r8', category: 'escalation', enabled: false, confidenceThreshold: 0.95 },
  { id: 'r9', category: 'spam', enabled: true, confidenceThreshold: 0.90 },
  { id: 'r10', category: 'other', enabled: false, confidenceThreshold: 0.85 },
];

export const CATEGORIES = [
  'sales', 'support', 'invoice', 'complaint', 'meeting',
  'investor', 'urgent', 'escalation', 'spam', 'other',
];

export const KB_TYPES = ['faq', 'policy', 'pricing', 'preference', 'contact', 'signature', 'tone-sample'];

export const CATEGORY_COLORS: Record<string, string> = {
  sales: 'bg-blue-100 text-blue-700',
  support: 'bg-green-100 text-green-700',
  invoice: 'bg-amber-100 text-amber-700',
  complaint: 'bg-red-100 text-red-700',
  meeting: 'bg-purple-100 text-purple-700',
  investor: 'bg-indigo-100 text-indigo-700',
  urgent: 'bg-orange-100 text-orange-700',
  escalation: 'bg-pink-100 text-pink-700',
  spam: 'bg-slate-100 text-slate-600',
  other: 'bg-slate-100 text-slate-600',
};
