export interface BlogSection {
  id: string;
  type: 'paragraph' | 'heading' | 'callout' | 'image';
  text?: string;
  level?: number;
  url?: string;
  caption?: string;
}

export interface Blog {
  id: string;
  title: string;
  subtitle?: string;
  status: 'Draft' | 'Published';
  lastSaved: string;
  words: number;
  readTime: string;
  sections: BlogSection[];
  seoScore: number;
  tone: string;
  audience: string;
  keywords: string[];
}

export const INITIAL_BLOGS: Blog[] = [
  {
    id: 'future-ai-business',
    title: 'The Future of AI in Business',
    status: 'Draft',
    lastSaved: 'Saved 2 min ago',
    words: 1245,
    readTime: '6 min',
    seoScore: 87,
    tone: 'General Tone',
    audience: 'Professionals',
    keywords: ['AI in Business', 'Automation', 'Machine Learning', 'Future of Work'],
    sections: [
      {
        id: 'sec-intro',
        type: 'paragraph',
        text: "Artificial Intelligence is no longer a futuristic concept—it's reshaping the way businesses operate, make decisions, and deliver value. From automation to predictive analytics, AI is becoming the core of modern business strategy."
      },
      {
        id: 'sec-h1-smarter',
        type: 'heading',
        level: 1,
        text: '1. Smarter Automation'
      },
      {
        id: 'sec-p-smarter',
        type: 'paragraph',
        text: 'AI-powered tools automate repetitive tasks, reduce human error, and free up teams to focus on high-value work. Businesses are using AI to streamline workflows, from customer support to data entry.'
      },
      {
        id: 'sec-callout-1',
        type: 'callout',
        text: 'Companies that embrace AI-driven automation today will lead the market tomorrow.'
      },
      {
        id: 'sec-h1-data',
        type: 'heading',
        level: 1,
        text: '2. Data-Driven Decisions'
      },
      {
        id: 'sec-p-data',
        type: 'paragraph',
        text: 'AI analyzes massive amounts of data in real-time and provides actionable insights. This helps businesses make smarter, faster, and more accurate decisions.'
      },
      {
        id: 'sec-image-1',
        type: 'image',
        url: '/ai_business_visualization.webp',
        caption: 'AI Data Analytics Visualization'
      }
    ]
  },
  {
    id: 'how-ai-changing-marketing',
    title: 'How AI is Changing Marketing',
    status: 'Draft',
    lastSaved: 'Saved 1 hour ago',
    words: 980,
    readTime: '5 min',
    seoScore: 82,
    tone: 'Creative',
    audience: 'Marketers',
    keywords: ['AI marketing', 'Content creation', 'Personalization'],
    sections: [
      {
        id: 'm-intro',
        type: 'paragraph',
        text: 'Marketing is experiencing a seismic shift thanks to artificial intelligence. From personalized content recommendations to predictive customer journeys, AI tools are helping marketers reach audiences like never before.'
      },
      {
        id: 'm-h1-personalization',
        type: 'heading',
        level: 1,
        text: 'Hyper-Personalization at Scale'
      },
      {
        id: 'm-p-personalization',
        type: 'paragraph',
        text: 'AI allows brands to analyze user actions in real-time, tailoring emails, ads, and product suggestions to each individual customer, significantly boosting engagement and conversion rates.'
      }
    ]
  },
  {
    id: 'remote-work-productivity',
    title: 'Remote Work Productivity Tips',
    status: 'Draft',
    lastSaved: 'Saved Yesterday',
    words: 1540,
    readTime: '8 min',
    seoScore: 91,
    tone: 'Informative',
    audience: 'General Audience',
    keywords: ['Remote Work', 'Productivity', 'WfH Tips'],
    sections: [
      {
        id: 'rw-intro',
        type: 'paragraph',
        text: 'Transitioning to a remote or hybrid work environment offers flexibility, but it also presents unique challenges to maintaining consistent daily focus and high productivity.'
      }
    ]
  },
  {
    id: 'best-ai-tools-2024',
    title: 'Best AI Tools in 2024',
    status: 'Published',
    lastSaved: 'Saved 2 days ago',
    words: 2150,
    readTime: '11 min',
    seoScore: 95,
    tone: 'Analytical',
    audience: 'Tech Enthusiasts',
    keywords: ['AI tools', 'Productivity apps', 'Top software'],
    sections: [
      {
        id: 'tools-intro',
        type: 'paragraph',
        text: 'As we progress through 2024, the landscape of artificial intelligence software has matured, moving from interesting tech demos to indispensable daily productivity engines.'
      }
    ]
  },
  {
    id: 'content-strategy-guide',
    title: 'Content Strategy Guide',
    status: 'Draft',
    lastSaved: 'Saved 3 days ago',
    words: 1890,
    readTime: '9 min',
    seoScore: 78,
    tone: 'Educational',
    audience: 'Content Creators',
    keywords: ['Content strategy', 'SEO guidelines', 'Blogging workflow'],
    sections: [
      {
        id: 'cs-intro',
        type: 'paragraph',
        text: 'A structured content strategy is the foundation of any successful digital presence. Without clear goals and planning, even the best written content will fail to rank.'
      }
    ]
  }
];

export const SIDEBAR_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
  { id: 'all-blogs', label: 'All Blogs', icon: 'FileText' },
  { id: 'drafts', label: 'Drafts', icon: 'FileEdit' },
  { id: 'templates', label: 'Templates', icon: 'Layers' },
  { id: 'ai-assistant', label: 'AI Assistant', icon: 'Bot' },
  { id: 'brand-voice', label: 'Brand Voice', icon: 'Volume2' },
  { id: 'history', label: 'History', icon: 'History' },
];
