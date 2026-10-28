import { getMovementById } from "@/lib/pulse/access";
import { notFound } from "next/navigation";
import Link from "next/link";
import { hasPulseAccess } from "@/lib/pulse/auth";
import { PulseAccessGate } from "@/app/pulse/access-gate";
import { generateProducts, type Product, type ProductType } from "./products";

const TYPE_LABELS: Record<string, string> = {
  tshirt: "T-Shirt",
  hoodie: "Hoodie",
  poster: "Poster",
  tote: "Tote Bag",
  sticker: "Sticker",
};

const PRODUCT_PHOTOS: Record<ProductType, string | null> = {
  tshirt: "/merch/tshirt.jpg",
  hoodie: "/merch/hoodie.jpg",
  poster: null,
  tote: "/merch/tote.jpg",
  sticker: null,
};

function hsl(hue: number, s: number, l: number) {
  return `hsl(${hue}, ${s}%, ${l}%)`;
}

function StickerSvg({ text }: { text: string }) {
  return (
    <svg viewBox="0 0 260 260" className="merch-sticker-svg">
      <circle cx="130" cy="130" r="120" fill="#fff" />
      <circle cx="130" cy="130" r="112" fill="none" stroke="#e05a33" strokeWidth="3" />
      <circle cx="130" cy="130" r="104" fill="none" stroke="#e05a33" strokeWidth="1" strokeDasharray="4,3" />
      <foreignObject x="40" y="55" width="180" height="150">
        <div className="merch-svg-text-sticker">{text}</div>
      </foreignObject>
    </svg>
  );
}

function PosterSvg({ text }: { text: string }) {
  return (
    <div className="merch-poster-card">
      <div className="merch-poster-inner">
        <div className="merch-poster-text">{text}</div>
        <div className="merch-poster-accent" />
      </div>
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  const photo = PRODUCT_PHOTOS[product.type];
  const overlayColor = hsl(product.hue, 60, 20);

  const renderContent = () => {
    if (photo) {
      return (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt={TYPE_LABELS[product.type]} />
          <div className="merch-print-overlay" style={{ color: overlayColor }}>
            {product.text}
          </div>
        </>
      );
    }
    if (product.type === "poster") return <PosterSvg text={product.text} />;
    return <StickerSvg text={product.text} />;
  };

  return (
    <div className="merch-card">
      <div className={`merch-photo-wrap merch-photo-${product.type}`}>
        {renderContent()}
      </div>
      <div className="merch-card-info">
        <span className="merch-card-type">{TYPE_LABELS[product.type] || product.type}</span>
        <span className="merch-card-name">{product.name}</span>
        <span className="merch-card-price">${product.price}</span>
      </div>
    </div>
  );
}

export default async function MerchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Checked here too: the layout is not re-run on client-side navigation.
  if (!(await hasPulseAccess())) return <PulseAccessGate />;

  const { id } = await params;
  const movement = await getMovementById(id);

  if (!movement) notFound();

  const products = generateProducts(movement);

  return (
    <div className="merch-page">
      <Link href={`/pulse/${id}`} className="pulse-back-link">
        &larr; Back to Movement
      </Link>

      <header className="merch-header">
        <div>
          <h1>{movement.name}</h1>
          <p className="merch-header-sub">Merch Preview Collection</p>
        </div>
        <div className="pulse-score-box">
          <span className="pulse-score-value">
            {Math.round(movement.merch_potential_score)}
          </span>
          <span className="pulse-score-label">Merch Potential</span>
        </div>
      </header>

      <div className="merch-grid">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}
