/**
 * Lightweight product visuals from category + name (no photo storage).
 * Returns a stable key; UI maps it to emoji (POS) or Lucide (lists).
 */

export type ProductVisualKey =
  | 'coffee'
  | 'tea'
  | 'juice'
  | 'soda'
  | 'water'
  | 'cake'
  | 'bakery'
  | 'ice_cream'
  | 'dairy'
  | 'snack'
  | 'chocolate'
  | 'fruit'
  | 'veg'
  | 'meat'
  | 'grocery'
  | 'pharmacy'
  | 'cleaning'
  | 'clothing'
  | 'phone'
  | 'electronic'
  | 'tool'
  | 'oil'
  | 'auto'
  | 'general';

type Rule = { key: ProductVisualKey; words: string[] };

/** Longer / more specific phrases first within each rule; rules ordered by priority. */
const RULES: Rule[] = [
  { key: 'coffee', words: ['كابتشينو', 'cappuccino', 'لاتيه', 'latte', 'اسبريسو', 'espresso', 'امريكانو', 'americano', 'موكا', 'mocha', 'قهوة', 'قهوه', 'coffee', 'cafe', 'كوفي'] },
  { key: 'tea', words: ['شاي', 'tea', 'ماتشا', 'matcha', 'كرك', 'ينسون', 'بابونج'] },
  { key: 'cake', words: ['تشيز كيك', 'تشيزكيك', 'cheesecake', 'كعكة', 'كيك', 'cake', 'تيراميسو', 'tiramisu', 'براوني', 'brownie', 'حلويات', 'dessert', 'حلوى'] },
  { key: 'bakery', words: ['كرواسون', 'croissant', 'دونات', 'donut', 'doughnut', 'خبز', 'bread', 'معجنات', 'مخبوز', 'bakery', 'فطيرة', 'pie', 'ساندويش', 'sandwich', 'توست', 'toast'] },
  { key: 'ice_cream', words: ['آيس كريم', 'ايس كريم', 'ice cream', 'جيلاتي', 'gelato', 'ميلك شيك', 'milkshake'] },
  { key: 'juice', words: ['عصير', 'juice', 'سموذي', 'smoothie', 'ليمونادة', 'lemonade', 'برتقال', 'orange', 'تفاح', 'مانجو', 'موز'] },
  { key: 'soda', words: ['كولا', 'cola', 'غازي', 'مشروب غازي', 'soda', 'بيبسي', 'pepsi', 'سفن', 'sprite', 'فانتا'] },
  { key: 'water', words: ['مياه', 'ماء', 'water', 'معدنية'] },
  { key: 'dairy', words: ['حليب', 'milk', 'لبن', 'زبادي', 'yogurt', 'جبن', 'جبنة', 'cheese', 'ألبان', 'البان', 'dairy', 'قشطة', 'زبدة', 'butter'] },
  { key: 'chocolate', words: ['شوكولاتة', 'شوكولاته', 'chocolate', 'كاكاو', 'cocoa'] },
  { key: 'snack', words: ['شيبس', 'chips', 'سناك', 'snack', 'بسكويت', 'biscuit', 'كوكي', 'cookie', 'مكسرات', 'nuts', 'فشار', 'popcorn'] },
  { key: 'fruit', words: ['فواكه', 'فاكهة', 'fruit', 'توت', 'فراولة', 'عنب', 'بطيخ'] },
  { key: 'veg', words: ['خضار', 'خضروات', 'vegetable', 'veg', 'طماطم', 'خيار', 'خس', 'بصل'] },
  { key: 'meat', words: ['لحم', 'دجاج', 'chicken', 'لحم بقري', 'meat', 'سمك', 'fish', 'برجر', 'burger', 'شاورما', 'كباب'] },
  { key: 'pharmacy', words: ['دواء', 'pharmacy', 'طب', 'فيتامين', 'vitamin', 'مسكن'] },
  { key: 'cleaning', words: ['منظف', 'تنظيف', 'cleaning', 'صابون', 'soap', 'شامبو', 'shampoo', 'مطهر'] },
  { key: 'clothing', words: ['ملابس', 'قميص', 'clothing', 'fashion', 'حذاء', 'shoe'] },
  { key: 'phone', words: ['جوال', 'هاتف', 'phone', 'mobile', 'آيفون', 'iphone', 'سامسونج'] },
  { key: 'electronic', words: ['إلكترون', 'الكترون', 'electronic', 'شاشة', 'سماعة', 'شاحن', 'cpu', 'شريحة', 'زينون'] },
  { key: 'tool', words: ['أداة', 'اداة', 'مفك', 'tool', 'wrench', 'كاوية', 'ملزم', 'أدوات', 'ادوات'] },
  { key: 'oil', words: ['زيت', 'oil', 'molygen', 'زيوت', 'صيانة'] },
  { key: 'auto', words: ['سيارة', 'قطع غيار', 'غيار', 'spares', 'فلتر', 'filter', 'سيارات'] },
  { key: 'grocery', words: ['بقالة', 'grocery', 'مواد غذائية', 'تموين', 'رز', 'سكر', 'طحين'] },
];

const EMOJI: Record<ProductVisualKey, string> = {
  coffee: '☕',
  tea: '🍵',
  juice: '🧃',
  soda: '🥤',
  water: '💧',
  cake: '🍰',
  bakery: '🥐',
  ice_cream: '🍦',
  dairy: '🥛',
  snack: '🍿',
  chocolate: '🍫',
  fruit: '🍎',
  veg: '🥬',
  meat: '🍖',
  grocery: '🛒',
  pharmacy: '💊',
  cleaning: '🫧',
  clothing: '👕',
  phone: '📱',
  electronic: '🔌',
  tool: '🔧',
  oil: '🛢️',
  auto: '🚗',
  general: '📦',
};

/** Soft tint for POS tiles / list avatars (Tailwind-friendly class fragments). */
const TONE: Record<ProductVisualKey, string> = {
  coffee: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  tea: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  juice: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  soda: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  water: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  cake: 'bg-pink-500/15 text-pink-700 dark:text-pink-300',
  bakery: 'bg-yellow-500/15 text-yellow-800 dark:text-yellow-300',
  ice_cream: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
  dairy: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  snack: 'bg-amber-500/10 text-amber-800 dark:text-amber-200',
  chocolate: 'bg-amber-900/15 text-amber-900 dark:text-amber-200',
  fruit: 'bg-red-500/15 text-red-700 dark:text-red-300',
  veg: 'bg-lime-500/15 text-lime-700 dark:text-lime-300',
  meat: 'bg-rose-500/15 text-rose-800 dark:text-rose-300',
  grocery: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  pharmacy: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
  cleaning: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  clothing: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  phone: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  electronic: 'bg-purple-500/15 text-purple-700 dark:text-purple-300',
  tool: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  oil: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
  auto: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  general: 'bg-slate-500/10 text-slate-500 dark:text-slate-400',
};

export function resolveProductVisualKey(category = '', name = ''): ProductVisualKey {
  const text = `${category} ${name}`.toLowerCase();
  if (!text.trim()) return 'general';
  for (const rule of RULES) {
    for (const word of rule.words) {
      if (text.includes(word.toLowerCase())) return rule.key;
    }
  }
  return 'general';
}

export function productVisualEmoji(category = '', name = ''): string {
  return EMOJI[resolveProductVisualKey(category, name)];
}

export function productVisualTone(category = '', name = ''): string {
  return TONE[resolveProductVisualKey(category, name)];
}

export function productVisualEmojiForKey(key: ProductVisualKey): string {
  return EMOJI[key];
}
