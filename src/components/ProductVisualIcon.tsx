import React from 'react';
import {
  Apple,
  Beef,
  CakeSlice,
  Car,
  Coffee,
  Cookie,
  Cpu,
  CupSoda,
  Droplets,
  GlassWater,
  IceCreamCone,
  Milk,
  Package,
  Phone,
  Pill,
  Popcorn,
  Salad,
  Shirt,
  ShoppingCart,
  Sparkles,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { resolveProductVisualKey, type ProductVisualKey } from '../lib/productVisual';

const ICONS: Record<ProductVisualKey, LucideIcon> = {
  coffee: Coffee,
  tea: Coffee,
  juice: CupSoda,
  soda: CupSoda,
  water: GlassWater,
  cake: CakeSlice,
  bakery: Cookie,
  ice_cream: IceCreamCone,
  dairy: Milk,
  snack: Popcorn,
  chocolate: Cookie,
  fruit: Apple,
  veg: Salad,
  meat: Beef,
  grocery: ShoppingCart,
  pharmacy: Pill,
  cleaning: Sparkles,
  clothing: Shirt,
  phone: Phone,
  electronic: Cpu,
  tool: Wrench,
  oil: Droplets,
  auto: Car,
  general: Package,
};

type Props = {
  category?: string;
  name?: string;
  className?: string;
  size?: number;
};

/** Lucide stand-in for a product — no binary image, key derived from category/name. */
export default function ProductVisualIcon({ category = '', name = '', className = 'w-5 h-5', size }: Props) {
  const key = resolveProductVisualKey(category, name);
  const Icon = ICONS[key];
  return <Icon className={className} size={size} aria-hidden />;
}
