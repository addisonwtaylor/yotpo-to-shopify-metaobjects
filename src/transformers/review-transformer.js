import { decodeHtmlEntities } from '../utils/html-decoder.js';

export function transformYotpoReview(yotpoReview, productId = null) {
  const isBrandReview = yotpoReview.sku === 'yotpo_site_reviews';
  const isActive = !yotpoReview.deleted && !yotpoReview.archived;

  // Base fields for both product and brand reviews
  const fields = [
    {
      key: 'yotpo_id',
      value: (yotpoReview.id || '').toString(),
    },
    {
      key: 'rating',
      value: (yotpoReview.score || 0).toString(),
    },
    {
      key: 'title',
      value: decodeHtmlEntities(yotpoReview.title) || '',
    },
    {
      key: 'content',
      value: decodeHtmlEntities(yotpoReview.content) || '',
    },
    {
      key: 'reviewer_name',
      value: decodeHtmlEntities(yotpoReview.name) || 'Anonymous',
    },
    {
      key: 'is_active',
      value: isActive.toString(),
    },
    {
      key: 'synced_at',
      value: new Date().toISOString(),
    },
  ];

  // Add optional reviewer email
  if (yotpoReview.email) {
    fields.push({
      key: 'reviewer_email',
      value: yotpoReview.email,
    });
  }

  // Add created date
  if (yotpoReview.created_at) {
    const date = new Date(yotpoReview.created_at);
    fields.push({
      key: 'created_date',
      value: date.toISOString().split('T')[0], // YYYY-MM-DD format
    });
  }

  // Add sentiment score (only if valid: between 0 and 1)
  if (typeof yotpoReview.sentiment !== 'undefined' && yotpoReview.sentiment !== null) {
    const sentiment = parseFloat(yotpoReview.sentiment);
    // Only add if it's a valid number between 0 and 1
    if (!isNaN(sentiment) && sentiment >= 0 && sentiment <= 1) {
      fields.push({
        key: 'sentiment_score',
        value: sentiment.toString(),
      });
    }
  }

  // Add helpful votes
  if (typeof yotpoReview.votes_up !== 'undefined' && yotpoReview.votes_up !== null) {
    fields.push({
      key: 'helpful_votes',
      value: yotpoReview.votes_up.toString(),
    });
  }

  // Product-specific fields (not for brand reviews)
  if (!isBrandReview) {
    fields.push({
      key: 'product_sku',
      value: yotpoReview.sku,
    });

    // Add product reference if we have a Shopify product ID
    if (productId) {
      fields.push({
        key: 'product_reference',
        value: productId,
      });
    }
  }

  return {
    fields,
    isBrandReview,
    isActive,
  };
}

export function shouldSyncReview(yotpoReview) {
  // Only sync active reviews (not deleted or archived)
  const isActive = !yotpoReview.deleted && !yotpoReview.archived;

  // Only sync reviews with required fields
  const hasRequiredFields =
    yotpoReview.id &&
    yotpoReview.score &&
    yotpoReview.title &&
    yotpoReview.content &&
    yotpoReview.sku;

  return isActive && hasRequiredFields;
}
