import type { FaqEntry } from './json-ld';

/*
 * The eleven pages that hang off the two hubs.
 *
 * **Why they are data and not eleven components.** They are the same page: a hero, a
 * capability list, a benefit grid, a worked example, who it suits, an FAQ, a call to
 * action. Written as components that is eleven files of identical JSX differing only in
 * their strings, and eleven places for the template to drift. Written as data it is one
 * template — `pages/DetailPage.tsx` — and a table anybody can edit without touching
 * React.
 *
 * **Why they exist at all, rather than "coming soon".** Every one of these is the page
 * a real search term lands on: "whatsapp number masking", "whatsapp team inbox",
 * "whatsapp lead management". A placeholder at those URLs is worse than nothing — it
 * burns the click and teaches the ranking system the site does not answer the query.
 * These are shorter than /features/whatsapp-automation and they are not pretending
 * otherwise, but each one answers its own question, carries its own FAQ markup, and is
 * a legitimate result for the term it targets.
 *
 * Every claim here is hedged the way the rest of the site's copy is — "can", "helps",
 * "authorized users" — because what any of it does depends on how a given workspace is
 * configured, and a product page is a bad place to promise otherwise.
 */

export interface Crumb { name: string; path: string }
export interface Tile { title: string; body: string }

export interface DetailPage {
  /** Key into `PAGE_HEADS`. The head lives there so the SEO table stays readable as a set. */
  headKey: string;
  path: string;
  crumbs: readonly Crumb[];
  h1: readonly string[];
  intro: readonly string[];
  listLabel: string;
  list: readonly string[];
  benefitsTitle: readonly string[];
  benefits: readonly Tile[];
  /** The worked example: a chain of stages, rendered with arrows between them. */
  flowTitle?: readonly string[];
  flowLead?: string;
  flow?: readonly string[];
  audienceTitle: readonly string[];
  audience: readonly Tile[];
  faqs: readonly FaqEntry[];
  related: readonly { label: string; href: string }[];
  ctaTitle: readonly string[];
  ctaBody: readonly string[];
}

const FEATURES_CRUMBS: readonly Crumb[] = [
  { name: 'Home', path: '/' },
  { name: 'Features', path: '/features' },
];

const SOLUTIONS_CRUMBS: readonly Crumb[] = [
  { name: 'Home', path: '/' },
  { name: 'Solutions', path: '/solutions' },
];

const crumbsFor = (base: readonly Crumb[], name: string, path: string): readonly Crumb[] =>
  [...base, { name, path }];

export const DETAIL_PAGES: readonly DetailPage[] = [
  /* ------------------------------------------------------------------ */
  /*                             Features                                */
  /* ------------------------------------------------------------------ */
  {
    headKey: 'sharedPortal',
    path: '/features/shared-whatsapp-portal',
    crumbs: crumbsFor(FEATURES_CRUMBS, 'Shared WhatsApp Portal', '/features/shared-whatsapp-portal'),
    h1: ['Give Your Entire Team One', 'Shared WhatsApp Portal'],
    intro: [
      'When several employees handle WhatsApp communication independently, businesses lose visibility into conversations and follow-ups.',
      'ZunoPilot’s Shared WhatsApp Portal provides a centralized environment where authorized team members can work with business conversations together, instead of customer communication depending on one employee’s device.',
    ],
    listLabel: 'A shared portal helps your team:',
    list: [
      'Keep customer communication accessible from one workspace',
      'Give authorized users access to the conversations they need',
      'Organize and manage customer interactions more efficiently',
      'Let sales, support and service teams work from the same environment',
      'See a clearer view of ongoing customer conversations',
      'Hand a conversation to the right person without forwarding screenshots',
    ],
    benefitsTitle: ['Why a Shared Portal', 'Beats Individual Phones'],
    benefits: [
      { title: 'Nothing Lives on One Phone', body: 'Customer conversations belong to the business rather than to whichever employee happened to answer first.' },
      { title: 'Visible Follow-Ups', body: 'A conversation waiting on a reply is visible to the team, not just to the person who opened it.' },
      { title: 'Controlled Access', body: 'Authorized users see the conversations their role needs, and access can be changed as your team changes.' },
      { title: 'Consistent Customer Experience', body: 'A customer gets the same quality of response regardless of who picks up the conversation.' },
      { title: 'Context on Handover', body: 'The next person can read what has already been said instead of asking the customer to repeat it.' },
      { title: 'Continuity as People Change', body: 'When someone leaves, the conversations and the relationships stay with the business.' },
    ],
    flowTitle: ['What a Shared Conversation', 'Looks Like'],
    flowLead: 'A single customer message can pass through several hands without the customer noticing a seam.',
    flow: [
      'Customer message arrives in the shared portal',
      'Automation or AI handles the routine part',
      'Conversation is picked up by an available team member',
      'Internal notes capture what was agreed',
      'Another agent can continue with full context',
    ],
    audienceTitle: ['Who a Shared Portal', 'Is Built For'],
    audience: [
      { title: 'Sales Teams', body: 'Several representatives working the same pipeline of WhatsApp enquiries.' },
      { title: 'Customer Support', body: 'Agents covering different shifts who need to pick up where the last one stopped.' },
      { title: 'Service Businesses', body: 'Front-desk staff and managers coordinating bookings and customer requests.' },
      { title: 'Multi-User Operations', body: 'Any business where more than one person needs to answer the same number.' },
      { title: 'High-Volume Conversations', body: 'Teams whose message volume has outgrown a single device.' },
    ],
    faqs: [
      {
        question: 'What is a Shared WhatsApp Portal?',
        answer:
          'A Shared WhatsApp Portal allows authorized team members to manage business conversations '
          + 'through one centralized workspace rather than relying on separate individual devices.',
      },
      {
        question: 'Can multiple employees use the same WhatsApp number?',
        answer:
          'Yes. ZunoPilot provides a shared environment where authorized team members can manage and '
          + 'collaborate on customer conversations connected to your business WhatsApp.',
      },
      {
        question: 'How is a shared portal different from a team inbox?',
        answer:
          'The portal is the workspace itself — where business conversations live and who can reach '
          + 'them. The Team Inbox is how multiple agents coordinate inside it, so conversations are '
          + 'not missed, duplicated, or handled by the wrong person.',
      },
      {
        question: 'Can I control who sees which conversations?',
        answer:
          'Access is given to authorized users, and what each user can reach depends on the role and '
          + 'permissions configured for them in your workspace.',
      },
      {
        question: 'What happens to conversations when an employee leaves?',
        answer:
          'Because conversations are managed through a business-controlled workspace rather than a '
          + 'personal device, customer communication stays with the business as your team changes.',
      },
    ],
    related: [
      { label: 'WhatsApp Team Inbox', href: '/features/whatsapp-team-inbox' },
      { label: 'WhatsApp Number Masking', href: '/features/whatsapp-number-masking' },
      { label: 'WhatsApp Automation', href: '/features/whatsapp-automation' },
    ],
    ctaTitle: ['Bring Your Conversations', 'Into One Place'],
    ctaBody: ['Give your team a shared workspace for business WhatsApp instead of a phone per person.'],
  },

  {
    headKey: 'numberMasking',
    path: '/features/whatsapp-number-masking',
    crumbs: crumbsFor(FEATURES_CRUMBS, 'WhatsApp Number Masking', '/features/whatsapp-number-masking'),
    h1: ['WhatsApp Number Masking for', 'Controlled Business Communication'],
    intro: [
      'When customers communicate directly with individual employees, business relationships become closely tied to personal or employee-managed numbers.',
      'ZunoPilot’s number masking capability helps businesses create a more controlled communication model while authorized users continue to manage conversations through the platform.',
    ],
    listLabel: 'Number masking helps your business:',
    list: [
      'Reduce unnecessary exposure of business and personal numbers',
      'Keep customer communication within your defined workflow',
      'Move customer interactions into a business-managed environment',
      'Give authorized users access without making individual phones the centre of your workflow',
      'Keep customer communication connected to your business as your team changes',
      'Maintain a more consistent customer-facing identity',
    ],
    benefitsTitle: ['Why Businesses Control', 'Customer-Facing Numbers'],
    benefits: [
      { title: 'The Relationship Stays With the Business', body: 'Customers deal with your business rather than with one employee’s personal number.' },
      { title: 'Fewer Off-Channel Conversations', body: 'Communication stays inside the workflow where it can be seen, continued and handed over.' },
      { title: 'Cleaner Team Changes', body: 'When staff change roles or leave, customer communication does not have to be migrated with them.' },
      { title: 'Consistent Records', body: 'Conversations that run through the platform are organized alongside the rest of your customer communication.' },
      { title: 'Privacy for Staff', body: 'Employees are not required to hand their personal numbers to customers to do their job.' },
      { title: 'Structured Access', body: 'Who can take part in customer conversations is a configuration rather than a matter of who has whose number.' },
    ],
    audienceTitle: ['Where Number Masking', 'Matters Most'],
    audience: [
      { title: 'Centralized Communication', body: 'Businesses that want customer conversations managed by the business, not by individuals.' },
      { title: 'Multi-User Teams', body: 'Several employees interacting with the same customer base.' },
      { title: 'Field and Service Staff', body: 'Teams who meet customers in person and would otherwise exchange personal numbers.' },
      { title: 'High-Turnover Roles', body: 'Operations where the person handling a customer changes often.' },
      { title: 'Customer-Facing Operations', body: 'Any business where the number a customer keeps matters more than who answered it.' },
    ],
    faqs: [
      {
        question: 'What is WhatsApp number masking?',
        answer:
          'WhatsApp number masking is a capability that can help businesses maintain greater control '
          + 'over customer-facing numbers while allowing authorized team members to manage '
          + 'conversations through a business communication system.',
      },
      {
        question: 'Does number masking hide my employees’ personal numbers?',
        answer:
          'The purpose is to reduce unnecessary exposure of numbers within customer-facing workflows, '
          + 'so customer conversations run through the business environment rather than through '
          + 'individual devices. What is exposed depends on how your workflow is configured.',
      },
      {
        question: 'Can my team still reply to customers?',
        answer:
          'Yes. Authorized team members manage the same conversations through the shared portal; '
          + 'masking changes where the conversation lives, not whether people can take part in it.',
      },
      {
        question: 'Why does number control matter for a growing business?',
        answer:
          'As a team grows, customer relationships tied to individual numbers become difficult to '
          + 'manage, hand over, or continue when someone leaves. Keeping communication in a '
          + 'business-managed environment keeps it connected to the business.',
      },
      {
        question: 'Does this work with the shared portal?',
        answer:
          'Yes. Number masking and the Shared WhatsApp Portal are designed to work together: '
          + 'communication is centralized, and authorized users manage it from one workspace.',
      },
    ],
    related: [
      { label: 'Shared WhatsApp Portal', href: '/features/shared-whatsapp-portal' },
      { label: 'WhatsApp Team Inbox', href: '/features/whatsapp-team-inbox' },
      { label: 'WhatsApp Automation', href: '/features/whatsapp-automation' },
    ],
    ctaTitle: ['Keep Business Communication', 'Under Your Control'],
    ctaBody: ['Move customer conversations into a business-managed environment your whole team can work from.'],
  },

  {
    headKey: 'campaigns',
    path: '/features/whatsapp-campaigns',
    crumbs: crumbsFor(FEATURES_CRUMBS, 'WhatsApp Campaigns', '/features/whatsapp-campaigns'),
    h1: ['Turn WhatsApp Into a', 'Customer Engagement Channel'],
    intro: [
      'WhatsApp can play an important role in marketing and customer engagement, but only when outreach is organized rather than sent one message at a time.',
      'ZunoPilot’s campaign capabilities let businesses organize customer communication for promotions, announcements, updates and other outreach, as part of the same environment their conversations already live in.',
    ],
    listLabel: 'Use campaigns for:',
    list: [
      'Promotions and offers',
      'Product and service announcements',
      'Customer updates',
      'Re-engaging customers who have gone quiet',
      'Structured marketing communication',
      'Ongoing customer engagement',
    ],
    benefitsTitle: ['Campaigns That Continue', 'Into Conversations'],
    benefits: [
      { title: 'Outreach and Replies in One Place', body: 'A customer who responds to a campaign lands in the same shared workspace as every other conversation.' },
      { title: 'Reusable Message Templates', body: 'Structured messages for recurring business communication rather than rewriting each send.' },
      { title: 'Targeted Audiences', body: 'Reach a defined group of customers instead of broadcasting the same thing to everybody.' },
      { title: 'A Campaign Can Become a Lead', body: 'Responses can feed into your follow-up workflows rather than sitting in a separate marketing tool.' },
      { title: 'Activity You Can See', body: 'Analytics show what was sent and what came back, so the next campaign is better informed.' },
      { title: 'Policy-Aware by Design', body: 'Campaigns work within WhatsApp’s template, consent and messaging requirements.' },
    ],
    flowTitle: ['From Campaign', 'to Conversation'],
    flowLead: 'The value of WhatsApp as a channel is that outreach and dialogue are the same thread.',
    flow: [
      'Choose an audience',
      'Send an approved template message',
      'Customer replies in the same thread',
      'Automation or AI handles the routine response',
      'Team member continues where it matters',
    ],
    audienceTitle: ['Who Runs WhatsApp', 'Campaigns'],
    audience: [
      { title: 'Marketing Teams', body: 'Promotions, launches and announcements delivered on a channel people actually read.' },
      { title: 'Ecommerce', body: 'Offers, restock notices and post-purchase communication.' },
      { title: 'Restaurants', body: 'Specials, events and reservations-driving outreach.' },
      { title: 'Service Businesses', body: 'Seasonal reminders and re-engagement for lapsed customers.' },
      { title: 'Growing Businesses', body: 'Any team that has outgrown sending the same message by hand.' },
    ],
    faqs: [
      {
        question: 'What are WhatsApp campaigns?',
        answer:
          'WhatsApp campaigns are structured outreach sends — promotions, announcements, updates '
          + 'and re-engagement messages — delivered to a defined audience of customers through '
          + 'your business WhatsApp.',
      },
      {
        question: 'Can WhatsApp automation be used for marketing?',
        answer:
          'Yes. WhatsApp automation can support campaigns, promotions, announcements, customer '
          + 'updates and re-engagement workflows, subject to applicable messaging rules and the '
          + 'business’s configured capabilities.',
      },
      {
        question: 'Do campaign messages need to be templates?',
        answer:
          'Business-initiated messages generally require approved templates under WhatsApp’s '
          + 'messaging rules. ZunoPilot supports message templates for this kind of recurring '
          + 'business communication.',
      },
      {
        question: 'What happens when a customer replies to a campaign?',
        answer:
          'The reply arrives in the same shared workspace as your other conversations, where '
          + 'automation, AI assistance or a team member can continue it.',
      },
      {
        question: 'Can I see how a campaign performed?',
        answer:
          'Yes. Analytics cover communication activity so you can understand what was sent and how '
          + 'customers responded.',
      },
    ],
    related: [
      { label: 'Marketing Automation', href: '/solutions/marketing-automation' },
      { label: 'Customer Engagement', href: '/solutions/customer-engagement' },
      { label: 'WhatsApp Automation', href: '/features/whatsapp-automation' },
    ],
    ctaTitle: ['Reach Customers Where', 'They Already Reply'],
    ctaBody: ['Run WhatsApp campaigns in the same place your customer conversations live.'],
  },

  {
    headKey: 'teamInbox',
    path: '/features/whatsapp-team-inbox',
    crumbs: crumbsFor(FEATURES_CRUMBS, 'WhatsApp Team Inbox', '/features/whatsapp-team-inbox'),
    h1: ['A WhatsApp Team Inbox That', 'Keeps Agents Out of Each Other’s Way'],
    intro: [
      'As your business grows, multiple employees need to respond to customers through WhatsApp. Without a structured approach, conversations get missed, answered twice, or handled by the wrong person.',
      'The ZunoPilot Team Inbox gives authorized users a shared environment for managing customer conversations and coordinating who is responding to what.',
    ],
    listLabel: 'A team inbox gives your agents:',
    list: [
      'One place where every customer conversation is visible',
      'Clear ownership, so two people do not answer the same message',
      'Internal notes that stay internal',
      'Handover with the conversation history intact',
      'A way to escalate what needs a more senior person',
      'Coverage across shifts without losing the thread',
    ],
    benefitsTitle: ['What Changes When Agents', 'Share an Inbox'],
    benefits: [
      { title: 'No Duplicate Replies', body: 'A conversation someone is already handling is visible as such to everyone else.' },
      { title: 'Nothing Falls Through', body: 'An unanswered conversation is a state the team can see rather than something someone has to remember.' },
      { title: 'Internal Notes', body: 'Context for the next agent, recorded on the conversation and never sent to the customer.' },
      { title: 'Human Takeover', body: 'An agent can step into an automated conversation the moment judgment is needed.' },
      { title: 'Shift Handover', body: 'The next shift picks up conversations mid-flight instead of starting from the customer’s last message.' },
      { title: 'Team Performance in View', body: 'Analytics show how conversations are being handled across the team.' },
    ],
    audienceTitle: ['Designed For'],
    audience: [
      { title: 'Customer Support Teams', body: 'Multiple agents answering the same queue of incoming requests.' },
      { title: 'Sales Teams', body: 'Representatives sharing inbound enquiries and passing qualified ones on.' },
      { title: 'Service Teams', body: 'Coordinating bookings, visits and follow-ups across staff.' },
      { title: 'Multi-Agent Operations', body: 'Any business where more than two people answer customers.' },
      { title: 'Growing Businesses', body: 'Teams adding agents faster than they can add process.' },
    ],
    faqs: [
      {
        question: 'What is a WhatsApp team inbox?',
        answer:
          'A WhatsApp team inbox is a shared environment where multiple authorized agents manage '
          + 'customer conversations together, with visibility over who is handling what.',
      },
      {
        question: 'Can multiple agents reply from the same WhatsApp number?',
        answer:
          'Yes. Authorized team members can manage and collaborate on conversations connected to your '
          + 'business WhatsApp from one shared workspace.',
      },
      {
        question: 'How do you stop two agents answering the same customer?',
        answer:
          'Conversations are managed in one shared view, so a conversation another agent is already '
          + 'handling is visible to the rest of the team rather than hidden on their device.',
      },
      {
        question: 'Can a human take over from automation?',
        answer:
          'Yes. Automated and AI-assisted conversations can be handed to a team member when a '
          + 'customer needs judgment, negotiation or detailed help.',
      },
      {
        question: 'Are internal notes visible to customers?',
        answer:
          'No. Internal notes are for your team and are not sent to the customer.',
      },
    ],
    related: [
      { label: 'Shared WhatsApp Portal', href: '/features/shared-whatsapp-portal' },
      { label: 'Customer Support', href: '/solutions/customer-support' },
      { label: 'AI WhatsApp Automation', href: '/features/ai-whatsapp-automation' },
    ],
    ctaTitle: ['Give Your Agents', 'One Inbox'],
    ctaBody: ['Coordinate customer conversations across your team instead of across their phones.'],
  },

  {
    headKey: 'businessApi',
    path: '/whatsapp-business-api',
    crumbs: [{ name: 'Home', path: '/' }, { name: 'WhatsApp Business API', path: '/whatsapp-business-api' }],
    h1: ['WhatsApp Business API for', 'Scalable Business Messaging'],
    intro: [
      'Businesses with more advanced communication requirements need WhatsApp to work alongside their applications and operational processes, not beside them.',
      'The WhatsApp Business API enables businesses to build scalable messaging experiences and connect WhatsApp with software, workflows, integrations and automated communication. ZunoPilot provides a platform for incorporating WhatsApp into those broader business processes.',
    ],
    listLabel: 'Use the WhatsApp Business API for:',
    list: [
      'Scalable messaging as volume grows',
      'Business notifications triggered by your own systems',
      'Automated customer communication',
      'Software and workflow integrations',
      'Customer support and lead management workflows',
      'Campaigns and customer engagement',
    ],
    benefitsTitle: ['What the API Makes', 'Possible'],
    benefits: [
      { title: 'Messaging Driven by Your Systems', body: 'An event in your application can trigger the WhatsApp communication that should follow it.' },
      { title: 'Volume Without More Staff', body: 'Communication capacity that grows with the business rather than with headcount.' },
      { title: 'Multi-Agent Access', body: 'Unlike the consumer app, business messaging is designed for teams working from a shared environment.' },
      { title: 'Structured Templates', body: 'Approved message templates for the recurring communication your operations depend on.' },
      { title: 'Automation and AI On Top', body: 'The API is the channel; ZunoPilot’s workflows and AI assistance are what make it a process.' },
      { title: 'Built for Compliance', body: 'Consent, template approval and messaging rules are part of how business messaging works.' },
    ],
    flowTitle: ['Connecting WhatsApp to', 'What Your Business Already Runs'],
    flowLead: 'The API earns its place when a business event, not a person, starts the conversation.',
    flow: [
      'An event happens in your system',
      'A workflow decides what communication should follow',
      'An approved WhatsApp message is sent',
      'The customer replies in the same thread',
      'AI or a team member continues the conversation',
    ],
    audienceTitle: ['Suitable For'],
    audience: [
      { title: 'Businesses With Existing Software', body: 'Teams that want WhatsApp connected to the systems they already operate.' },
      { title: 'High-Volume Messaging', body: 'Operations sending notifications or updates at a scale no one can send by hand.' },
      { title: 'Operations Teams', body: 'Confirmations, reminders, alerts and status updates driven by real business events.' },
      { title: 'Multi-Agent Support Teams', body: 'Businesses that need several people answering one business number.' },
      { title: 'Growing Companies', body: 'Anyone whose communication requirements have outgrown the WhatsApp Business app.' },
    ],
    faqs: [
      {
        question: 'What is the WhatsApp Business API?',
        answer:
          'The WhatsApp Business API lets businesses build scalable messaging experiences and connect '
          + 'WhatsApp with their software, workflows, integrations and automated communication, rather '
          + 'than sending messages manually from a phone.',
      },
      {
        question: 'How is it different from the WhatsApp Business app?',
        answer:
          'The app is designed for a single user on a device. The API is designed for businesses that '
          + 'need multiple team members, automated communication, integrations with other systems, and '
          + 'higher messaging volumes.',
      },
      {
        question: 'Do I need developers to use it?',
        answer:
          'ZunoPilot provides a platform on top of business messaging, so common workflows — '
          + 'automation, campaigns, the shared portal, the team inbox — are configured rather than '
          + 'built. Deeper integrations with your own systems may involve development work.',
      },
      {
        question: 'What are the messaging rules?',
        answer:
          'Businesses need to use approved WhatsApp business products and comply with applicable '
          + 'WhatsApp policies, messaging requirements, consent rules and template requirements where '
          + 'applicable. ZunoPilot should be configured and used according to those requirements.',
      },
      {
        question: 'Can the API be combined with AI automation?',
        answer:
          'Yes. AI assistance and automated workflows operate on top of business messaging, so routine '
          + 'interactions can be handled automatically while your team handles the rest.',
      },
    ],
    related: [
      { label: 'WhatsApp Automation', href: '/features/whatsapp-automation' },
      { label: 'AI WhatsApp Automation', href: '/features/ai-whatsapp-automation' },
      { label: 'All features', href: '/features' },
    ],
    ctaTitle: ['Connect WhatsApp to', 'the Way You Work'],
    ctaBody: ['Bring WhatsApp into your business processes instead of running it alongside them.'],
  },

  {
    headKey: 'industries',
    path: '/industries',
    crumbs: [{ name: 'Home', path: '/' }, { name: 'Industries', path: '/industries' }],
    h1: ['WhatsApp Automation for', 'Your Industry'],
    intro: [
      'The communication a restaurant repeats every day is not the communication a real estate agency repeats — but both repeat something, and that is what automation is for.',
      'ZunoPilot is used across industries to automate enquiries, follow-ups, reminders, notifications and campaigns on WhatsApp, with the same shared portal and team collaboration underneath.',
    ],
    listLabel: 'Across every industry, businesses automate:',
    list: [
      'Incoming customer enquiries',
      'Follow-ups after the first conversation',
      'Bookings, orders and appointment communication',
      'Reminders and status updates',
      'Promotions and announcements',
      'Re-engagement of past customers',
    ],
    benefitsTitle: ['Industries Using', 'WhatsApp Automation'],
    benefits: [
      { title: 'Restaurants', body: 'Automate enquiries, reservations, order communication, promotions and customer engagement.' },
      { title: 'Ecommerce', body: 'Manage customer enquiries, order updates, promotions and post-purchase communication.' },
      { title: 'Real Estate', body: 'Manage property enquiries, lead conversations, follow-ups and customer communication.' },
      { title: 'Education', body: 'Streamline enquiries, admissions communication, reminders and updates.' },
      { title: 'Service Businesses', body: 'Automate enquiries, bookings, reminders, notifications and customer support.' },
      { title: 'Healthcare & Clinics', body: 'Appointment reminders, confirmations and routine patient communication, handled consistently.' },
    ],
    audienceTitle: ['What Every Industry', 'Has in Common'],
    audience: [
      { title: 'The Same First Question', body: 'Every business answers a handful of questions far more often than the rest.' },
      { title: 'Follow-Ups That Slip', body: 'The enquiry that goes quiet because nobody remembered to come back to it.' },
      { title: 'Conversations on One Phone', body: 'Customer relationships living on a device rather than in the business.' },
      { title: 'Predictable Reminders', body: 'Appointments, orders and services that always need the same message at the same point.' },
      { title: 'Customers Who Go Quiet', body: 'Past customers worth another touchpoint, on a channel they will actually see.' },
    ],
    faqs: [
      {
        question: 'Which industries use WhatsApp automation?',
        answer:
          'Restaurants, ecommerce, real estate, education, healthcare and service businesses all use '
          + 'WhatsApp automation for enquiries, follow-ups, reminders, notifications and campaigns.',
      },
      {
        question: 'Is WhatsApp automation suitable for small businesses?',
        answer:
          'Yes. Small businesses can begin with a limited number of repetitive workflows and expand '
          + 'their automation as customer communication grows.',
      },
      {
        question: 'Can restaurants use WhatsApp for orders and reservations?',
        answer:
          'Yes. Restaurants can automate enquiries, reservation communication, order updates and '
          + 'promotions, with staff taking over conversations that need a person.',
      },
      {
        question: 'How does ecommerce use WhatsApp automation?',
        answer:
          'Ecommerce businesses commonly automate order updates, delivery notifications, '
          + 'post-purchase communication and promotional campaigns, alongside answering customer '
          + 'enquiries.',
      },
      {
        question: 'Do I need a different setup for my industry?',
        answer:
          'The platform is the same; what differs is the workflows you configure. The enquiries, '
          + 'reminders and follow-ups your business repeats are what get automated.',
      },
    ],
    related: [
      { label: 'All features', href: '/features' },
      { label: 'All solutions', href: '/solutions' },
      { label: 'WhatsApp Automation', href: '/features/whatsapp-automation' },
    ],
    ctaTitle: ['Automate What Your', 'Business Repeats Every Day'],
    ctaBody: ['Whatever you sell, the routine communication around it can run itself.'],
  },

  /* ------------------------------------------------------------------ */
  /*                            Solutions                                */
  /* ------------------------------------------------------------------ */
  {
    headKey: 'leadManagement',
    path: '/solutions/lead-management',
    crumbs: crumbsFor(SOLUTIONS_CRUMBS, 'Lead Management', '/solutions/lead-management'),
    h1: ['Capture and Follow Up With', 'More WhatsApp Leads'],
    intro: [
      'Every customer enquiry represents a potential opportunity. But when leads arrive through WhatsApp, manually tracking every conversation and follow-up becomes difficult as enquiry volume increases.',
      'ZunoPilot helps businesses create a more organized approach to WhatsApp lead management — from the first enquiry to the follow-up conversations that decide whether it goes anywhere.',
    ],
    listLabel: 'Use WhatsApp for:',
    list: [
      'New lead enquiries',
      'Prospect communication',
      'Lead follow-ups',
      'Qualification conversations',
      'Sales handoffs',
      'Re-engagement of quiet prospects',
    ],
    benefitsTitle: ['Why Leads Are Lost,', 'and What Changes'],
    benefits: [
      { title: 'Fast First Response', body: 'A new enquiry gets an answer without waiting for someone to notice it.' },
      { title: 'Qualification Before Handoff', body: 'Relevant details are gathered so a representative starts with context instead of questions.' },
      { title: 'Follow-Ups That Actually Happen', body: 'The next touchpoint is part of a workflow rather than something someone has to remember.' },
      { title: 'Nothing Sitting Unanswered', body: 'Enquiries are visible to the team in one shared workspace.' },
      { title: 'A Clear Route to Sales', body: 'Qualified conversations reach the right person with the history attached.' },
      { title: 'Re-Engagement', body: 'Prospects who went quiet can be brought back with an appropriate follow-up.' },
    ],
    flowTitle: ['The Lead Journey', 'on WhatsApp'],
    flowLead: 'A WhatsApp enquiry becomes a sales opportunity only if the conversation continues.',
    flow: [
      'New enquiry',
      'Initial response',
      'Requirement collection',
      'Lead qualification',
      'Sales team involvement',
      'Follow-up',
      'Conversion',
    ],
    audienceTitle: ['Who This Is For'],
    audience: [
      { title: 'Inbound Sales Teams', body: 'Businesses whose enquiries arrive faster than they can be worked by hand.' },
      { title: 'Real Estate', body: 'Property enquiries that need qualification before an agent invests time.' },
      { title: 'Education', body: 'Admissions enquiries with a long, reminder-driven decision cycle.' },
      { title: 'Service Businesses', body: 'Quote requests that need details gathered before anyone can respond usefully.' },
      { title: 'Growing Businesses', body: 'Teams where following up is the first thing to slip when things get busy.' },
    ],
    faqs: [
      {
        question: 'How can ZunoPilot help with lead management?',
        answer:
          'ZunoPilot helps businesses structure WhatsApp communication for new enquiries, prospect '
          + 'engagement, follow-ups, qualification and sales handoffs.',
      },
      {
        question: 'Can WhatsApp automation help with lead generation?',
        answer:
          'Yes. Businesses can use WhatsApp workflows to respond to enquiries, collect information, '
          + 'qualify prospects, initiate follow-ups and connect potential customers with sales teams.',
      },
      {
        question: 'Can AI qualify leads?',
        answer:
          'AI can assist with identifying customer requirements, asking configured qualification '
          + 'questions, collecting relevant information and directing suitable conversations toward a '
          + 'sales workflow.',
      },
      {
        question: 'What happens to a lead after it is qualified?',
        answer:
          'The conversation can be routed to the appropriate team member through the shared portal, '
          + 'with the information already gathered attached to it.',
      },
      {
        question: 'Can I follow up with leads automatically?',
        answer:
          'Yes. Follow-up workflows can keep conversations moving after the initial interaction, '
          + 'subject to applicable WhatsApp messaging and consent requirements.',
      },
    ],
    related: [
      { label: 'Sales Automation', href: '/solutions/sales-automation' },
      { label: 'AI WhatsApp Automation', href: '/features/ai-whatsapp-automation' },
      { label: 'WhatsApp Automation', href: '/features/whatsapp-automation' },
    ],
    ctaTitle: ['Stop Losing Leads', 'to Forgotten Follow-Ups'],
    ctaBody: ['Give every WhatsApp enquiry a response, a qualification step and a next touchpoint.'],
  },

  {
    headKey: 'salesAutomation',
    path: '/solutions/sales-automation',
    crumbs: crumbsFor(SOLUTIONS_CRUMBS, 'Sales Automation', '/solutions/sales-automation'),
    h1: ['Keep Sales Conversations', 'Moving on WhatsApp'],
    intro: [
      'Sales teams spend a significant amount of time answering similar questions, checking on prospects and sending follow-up messages — work that is repeatable by definition.',
      'ZunoPilot helps businesses structure those recurring activities so representatives spend their time on conversations that need product knowledge, negotiation or personal attention.',
    ],
    listLabel: 'Support your sales process with:',
    list: [
      'Automated follow-ups',
      'Prospect engagement',
      'Responses to common sales enquiries',
      'Qualification workflows',
      'Customer communication that stays consistent',
      'Opportunity follow-up',
    ],
    benefitsTitle: ['What Automation Gives', 'a Sales Team Back'],
    benefits: [
      { title: 'Time on the Right Conversations', body: 'Representatives spend their day on qualified opportunities rather than on first replies.' },
      { title: 'Consistent Follow-Up Cadence', body: 'Every prospect gets the same discipline, not just the ones somebody remembered.' },
      { title: 'Context Before the Call', body: 'The requirements gathered during the automated stage are there when a person takes over.' },
      { title: 'Faster Response Times', body: 'A prospect who asks at 9pm is not waiting until the morning for an acknowledgement.' },
      { title: 'Shared Pipeline Visibility', body: 'The team can see which conversations are live rather than asking who owns what.' },
      { title: 'Fewer Dropped Opportunities', body: 'Follow-up is a workflow step rather than an act of memory.' },
    ],
    audienceTitle: ['Who This Is For'],
    audience: [
      { title: 'Inside Sales', body: 'Teams working a steady flow of inbound WhatsApp enquiries.' },
      { title: 'Field Sales', body: 'Representatives who cannot answer immediately and need the first response handled.' },
      { title: 'Small Sales Teams', body: 'Businesses where the same two or three people do prospecting, quoting and closing.' },
      { title: 'High-Enquiry Businesses', body: 'Operations where volume, not effort, is the constraint.' },
      { title: 'Business Owners', body: 'Founders still personally answering every enquiry that comes in.' },
    ],
    faqs: [
      {
        question: 'Can WhatsApp be used for sales automation?',
        answer:
          'Yes. WhatsApp can support sales activities such as prospect engagement, follow-ups, '
          + 'qualification, customer communication and other repeatable sales processes.',
      },
      {
        question: 'Does automation replace sales representatives?',
        answer:
          'No. Automation handles the repeatable parts of the customer journey. Representatives focus '
          + 'on conversations that require product knowledge, negotiation or personal attention.',
      },
      {
        question: 'Can follow-ups be scheduled automatically?',
        answer:
          'Yes. Follow-up workflows can be triggered or scheduled so the next touchpoint happens '
          + 'without relying on someone to remember it.',
      },
      {
        question: 'How does this work with lead management?',
        answer:
          'Lead management covers capturing and qualifying enquiries; sales automation covers keeping '
          + 'those conversations moving toward an outcome. Most businesses use both together.',
      },
      {
        question: 'Will my team see the automated conversations?',
        answer:
          'Yes. Automated conversations live in the same shared workspace, so a representative can '
          + 'read the history and step in at any point.',
      },
    ],
    related: [
      { label: 'Lead Management', href: '/solutions/lead-management' },
      { label: 'WhatsApp Automation', href: '/features/whatsapp-automation' },
      { label: 'Shared WhatsApp Portal', href: '/features/shared-whatsapp-portal' },
    ],
    ctaTitle: ['Let Your Team Sell,', 'Not Retype'],
    ctaBody: ['Automate the repeatable half of the sales conversation and keep the rest human.'],
  },

  {
    headKey: 'customerSupport',
    path: '/solutions/customer-support',
    crumbs: crumbsFor(SOLUTIONS_CRUMBS, 'Customer Support', '/solutions/customer-support'),
    h1: ['Give Customers a More', 'Connected Support Experience'],
    intro: [
      'Customers expect businesses to be accessible when they need help. Managing support conversations through individual phones or disconnected processes makes consistency hard to maintain.',
      'ZunoPilot helps businesses create a more organized WhatsApp support workflow: routine interactions follow predefined processes, and agents take over when a customer needs detailed assistance.',
    ],
    listLabel: 'Support customer communication through:',
    list: [
      'Customer enquiries',
      'Service requests',
      'Frequently asked questions',
      'Status updates',
      'Follow-ups after an issue is resolved',
      'Escalation to the right person',
    ],
    benefitsTitle: ['A Support Process', 'Instead of a Phone'],
    benefits: [
      { title: 'Routine Questions Answered Immediately', body: 'Predictable requests are handled by workflows or AI assistance rather than queuing for an agent.' },
      { title: 'Agents on the Hard Cases', body: 'Human expertise goes to complex, sensitive and detailed problems.' },
      { title: 'Escalation That Works', body: 'A conversation that needs a person reaches one, with the history attached.' },
      { title: 'Consistent Answers', body: 'Structured workflows mean the same question does not get three different answers.' },
      { title: 'Shift Coverage', body: 'Conversations are visible across the team rather than trapped on one agent’s device.' },
      { title: 'Support Volume You Can Absorb', body: 'Handling more conversations does not have to mean proportionally more agents.' },
    ],
    flowTitle: ['A Support Conversation,', 'End to End'],
    flowLead: 'Most support requests follow a shape. Automating the shape is what leaves room for the exceptions.',
    flow: [
      'Customer question',
      'Identify the request',
      'Provide relevant assistance',
      'Determine whether escalation is required',
      'Connect the customer with the support team',
    ],
    audienceTitle: ['Who This Is For'],
    audience: [
      { title: 'Support Teams', body: 'Agents handling a recurring queue of customer requests.' },
      { title: 'Ecommerce', body: 'Order status, returns and delivery questions arriving in volume.' },
      { title: 'Service Businesses', body: 'Customers needing help before, during and after a service.' },
      { title: 'Small Teams', body: 'Businesses where support is one of several jobs the same person does.' },
      { title: 'Growing Businesses', body: 'Operations whose support volume is rising faster than headcount.' },
    ],
    faqs: [
      {
        question: 'How can businesses use WhatsApp for customer support?',
        answer:
          'Businesses can use WhatsApp for enquiries, support requests, updates and follow-ups. '
          + 'ZunoPilot adds structured workflows, AI assistance and team-based conversation management '
          + 'to those processes.',
      },
      {
        question: 'Does automation replace customer support agents?',
        answer:
          'No. Automation is useful for predictable and repetitive interactions. Support agents '
          + 'continue handling complex issues, sensitive requests and conversations that require human '
          + 'judgment.',
      },
      {
        question: 'Can AI answer customer support questions?',
        answer:
          'AI can assist with suitable routine customer questions using configured business '
          + 'information, and help route conversations that require human support.',
      },
      {
        question: 'How does escalation work?',
        answer:
          'When a conversation needs a person, it can be handed to the appropriate team member through '
          + 'the shared portal, with everything already said attached to it.',
      },
      {
        question: 'Can several agents handle support together?',
        answer:
          'Yes. The Team Inbox gives authorized agents a shared environment so conversations are not '
          + 'missed, duplicated, or handled by the wrong person.',
      },
    ],
    related: [
      { label: 'WhatsApp Team Inbox', href: '/features/whatsapp-team-inbox' },
      { label: 'AI WhatsApp Automation', href: '/features/ai-whatsapp-automation' },
      { label: 'Shared WhatsApp Portal', href: '/features/shared-whatsapp-portal' },
    ],
    ctaTitle: ['Support Customers Without', 'Answering the Same Question Twice'],
    ctaBody: ['Automate the routine half of support and give your agents the rest.'],
  },

  {
    headKey: 'marketingAutomation',
    path: '/solutions/marketing-automation',
    crumbs: crumbsFor(SOLUTIONS_CRUMBS, 'Marketing Automation', '/solutions/marketing-automation'),
    h1: ['WhatsApp Marketing Automation', 'That Starts Conversations'],
    intro: [
      'Marketing doesn’t stop when a customer first discovers your business. Promotions, announcements, product updates and offers all need to reach people throughout the relationship.',
      'ZunoPilot helps businesses incorporate WhatsApp into their customer engagement strategy through structured campaign and communication workflows — on a channel where a message is read and can be replied to.',
    ],
    listLabel: 'Marketing use cases include:',
    list: [
      'Promotions and offers',
      'Product announcements',
      'Customer updates',
      'Re-engagement of lapsed customers',
      'Campaign communication',
      'Ongoing audience engagement',
    ],
    benefitsTitle: ['Why WhatsApp Marketing', 'Works Differently'],
    benefits: [
      { title: 'Messages That Get Read', body: 'WhatsApp is a channel customers already use, rather than one they filter.' },
      { title: 'Two-Way by Default', body: 'A campaign can start a conversation instead of ending in a click-through.' },
      { title: 'Responses Become Leads', body: 'Someone who replies to a promotion can enter your follow-up workflow immediately.' },
      { title: 'Targeted Sends', body: 'Reach a defined audience rather than broadcasting to everyone.' },
      { title: 'Reusable Templates', body: 'Structured messages for the outreach you repeat every month.' },
      { title: 'Consent-Aware', body: 'Campaigns operate within WhatsApp’s messaging, template and consent requirements.' },
    ],
    audienceTitle: ['Who This Is For'],
    audience: [
      { title: 'Marketing Teams', body: 'Running promotions and announcements on a channel with real attention.' },
      { title: 'Ecommerce', body: 'Offers, launches and post-purchase engagement.' },
      { title: 'Restaurants', body: 'Specials, events and reservation-driving campaigns.' },
      { title: 'Service Businesses', body: 'Seasonal offers and reminders to customers who have not been back.' },
      { title: 'Business Owners', body: 'Anyone still sending the same promotional message by hand, one chat at a time.' },
    ],
    faqs: [
      {
        question: 'Can ZunoPilot support WhatsApp marketing?',
        answer:
          'Yes. ZunoPilot can support WhatsApp campaigns and customer engagement workflows for '
          + 'promotions, announcements, updates and re-engagement, subject to applicable messaging '
          + 'requirements and configured capabilities.',
      },
      {
        question: 'What is WhatsApp marketing automation?',
        answer:
          'WhatsApp marketing automation uses campaigns, templates and workflows to deliver '
          + 'promotional and engagement communication to customers, and to handle what happens when '
          + 'they reply.',
      },
      {
        question: 'Do I need customer consent to send marketing messages?',
        answer:
          'Yes. Business-initiated messaging on WhatsApp is subject to consent rules and template '
          + 'requirements, and campaigns should be configured and used according to those '
          + 'requirements.',
      },
      {
        question: 'What happens when someone replies to a campaign?',
        answer:
          'The reply arrives in the same shared workspace as your other conversations, where '
          + 'automation, AI assistance or a team member can continue it.',
      },
      {
        question: 'How is this different from email marketing?',
        answer:
          'The main practical difference is that a WhatsApp campaign lands in a conversation. A reply '
          + 'is a message your team can answer, not a bounce or an unsubscribe.',
      },
    ],
    related: [
      { label: 'WhatsApp Campaigns', href: '/features/whatsapp-campaigns' },
      { label: 'Customer Engagement', href: '/solutions/customer-engagement' },
      { label: 'Lead Management', href: '/solutions/lead-management' },
    ],
    ctaTitle: ['Market on a Channel', 'That Answers Back'],
    ctaBody: ['Run WhatsApp campaigns that turn into conversations rather than into unsubscribes.'],
  },

  {
    headKey: 'customerEngagement',
    path: '/solutions/customer-engagement',
    crumbs: crumbsFor(SOLUTIONS_CRUMBS, 'Customer Engagement', '/solutions/customer-engagement'),
    h1: ['Stay Connected Beyond the', 'First Conversation'],
    intro: [
      'A successful customer relationship involves multiple interactions. A customer may need a reminder after an enquiry, an update after a purchase, or useful information once they have become a customer.',
      'ZunoPilot helps businesses build ongoing WhatsApp communication around these moments, so every message is part of a connected journey rather than an isolated interaction.',
    ],
    listLabel: 'Customer engagement can support:',
    list: [
      'Follow-up communication',
      'Customer updates',
      'Reminders for appointments, orders and services',
      'Re-engagement of quiet customers',
      'Relationship building over time',
      'Repeat interactions and repeat business',
    ],
    benefitsTitle: ['Engagement That Comes', 'From the Business, Not the Calendar'],
    benefits: [
      { title: 'Timely, Not Constant', body: 'Communication triggered by real customer moments rather than by an arbitrary schedule.' },
      { title: 'Reminders That Land', body: 'Appointments, orders and services confirmed on a channel people read.' },
      { title: 'Fewer Customers Going Quiet', body: 'Re-engagement workflows for people worth another touchpoint.' },
      { title: 'Consistent Post-Purchase Contact', body: 'The communication after the sale is as reliable as the communication before it.' },
      { title: 'One Continuous Thread', body: 'Every interaction sits in the same conversation, so context is never lost.' },
      { title: 'Repeat Business', body: 'Staying in contact is what turns a first purchase into a second.' },
    ],
    flowTitle: ['A Customer Relationship', 'as a Sequence'],
    flowLead: 'The point is not to send more messages. It is that each one follows from something the customer actually did.',
    flow: [
      'First enquiry answered',
      'Purchase or booking confirmed',
      'Reminder or update at the right moment',
      'Follow-up after the service',
      'Re-engagement when the time is right',
    ],
    audienceTitle: ['Who This Is For'],
    audience: [
      { title: 'Service Businesses', body: 'Customers who return on a cycle and need reminding when it comes around.' },
      { title: 'Ecommerce', body: 'Post-purchase communication that turns a first order into a second.' },
      { title: 'Healthcare & Clinics', body: 'Appointment reminders and routine follow-up communication.' },
      { title: 'Restaurants', body: 'Staying in contact with regulars between visits.' },
      { title: 'Any Repeat-Purchase Business', body: 'Operations where retention matters more than acquisition.' },
    ],
    faqs: [
      {
        question: 'What is WhatsApp customer engagement?',
        answer:
          'WhatsApp customer engagement is ongoing communication with customers after the first '
          + 'interaction — follow-ups, updates, reminders and re-engagement — delivered as part '
          + 'of a connected conversation rather than as isolated messages.',
      },
      {
        question: 'Can reminders be sent automatically?',
        answer:
          'Yes. Businesses can create workflows around appointments, orders, services and other '
          + 'activities where a reminder is appropriate, subject to applicable messaging requirements.',
      },
      {
        question: 'How is engagement different from marketing?',
        answer:
          'Marketing is generally outreach to an audience. Engagement is communication that follows '
          + 'from something a specific customer did — an enquiry, a purchase, an appointment.',
      },
      {
        question: 'Can I re-engage customers who have gone quiet?',
        answer:
          'Yes. Re-engagement workflows can reach customers who need another touchpoint, within '
          + 'WhatsApp’s messaging and consent rules.',
      },
      {
        question: 'Does this work alongside customer support?',
        answer:
          'Yes. Both run through the same shared workspace, so a customer who replies to an engagement '
          + 'message and then needs help stays in one continuous conversation.',
      },
    ],
    related: [
      { label: 'WhatsApp Campaigns', href: '/features/whatsapp-campaigns' },
      { label: 'Marketing Automation', href: '/solutions/marketing-automation' },
      { label: 'Customer Support', href: '/solutions/customer-support' },
    ],
    ctaTitle: ['Keep the Conversation', 'Going After the Sale'],
    ctaBody: ['Build WhatsApp communication around real customer moments, not a send schedule.'],
  },
];

/** Lookup by route path, for the template to resolve itself. */
export const DETAIL_BY_PATH = new Map(DETAIL_PAGES.map((p) => [p.path, p]));
