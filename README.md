# Yotpo to Shopify Review Sync

Sync product reviews from Yotpo to Shopify as metaobjects. Query them in your theme using the Shopify Admin API.

## What This Does

This tool pulls reviews from your Yotpo account and pushes them into Shopify as metaobjects. Once synced, you can build custom review displays in your theme without relying on third-party widgets.

## Prerequisites

You'll need:
- Node.js 20 or higher
- A Yotpo account with API access
- A Shopify store with a custom app configured

For Shopify, your custom app needs these API scopes:
- `write_metaobject_definitions`
- `read_metaobjects`
- `write_metaobjects`
- `read_products`

## Installation

Clone this repository and install dependencies:

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Fill in your credentials:

```env
# Yotpo API Credentials
YOTPO_APP_KEY=your_yotpo_app_key
YOTPO_APP_SECRET=your_yotpo_secret

# Shopify API Credentials
SHOPIFY_SHOP_URL=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=your_admin_api_token
SHOPIFY_API_VERSION=2025-07
```

### Getting Your Credentials

**Yotpo:**
1. Log into Yotpo
2. Navigate to Settings → Store Settings
3. Copy your App Key and Secret Key

**Shopify:**
1. In your Shopify admin, go to Settings → Apps and sales channels
2. Click "Develop apps" (you may need to enable this feature)
3. Create a new app or select an existing one
4. Add the required API scopes listed above
5. Install the app and copy the Admin API access token

## Setup

Before syncing reviews, create the metaobject definitions in Shopify:

```bash
npm run setup
npm run setup:statistics
```

This creates two metaobject types:
- `yotpo_review` - Individual review data
- `yotpo_review_statistics` - Aggregated stats per product

You only need to run these commands once.

## Usage

### Sync Reviews

To sync all reviews from Yotpo:

```bash
npm run sync
```

This will:
1. Fetch all reviews from Yotpo (with pagination)
2. Create or update metaobjects in Shopify
3. Calculate and sync review statistics per product

The sync is incremental - existing reviews will be updated rather than duplicated.

### Sync Statistics Only

If you just want to update the aggregated statistics:

```bash
npm run sync:statistics
```

This recalculates average ratings, review counts, and star distributions without touching individual reviews.

## Querying Reviews in Your Theme

### Individual Reviews

Use GraphQL to query reviews by product SKU:

```graphql
query GetProductReviews($sku: String!) {
  metaobjects(
    type: "yotpo_review"
    first: 50
    query: $sku
  ) {
    edges {
      node {
        fields {
          key
          value
        }
      }
    }
  }
}
```

### Review Statistics

Get pre-calculated statistics for fast loading:

```graphql
query GetReviewStatistics($sku: String!) {
  metaobjects(
    type: "yotpo_review_statistics"
    first: 1
    query: $sku
  ) {
    edges {
      node {
        fields {
          key
          value
        }
      }
    }
  }
}
```

Returns:
- Average rating
- Total review count
- Star distribution (5-star to 1-star counts)

### Global Statistics

For store-wide review stats (useful for homepage displays):

```graphql
query GetGlobalReviewStatistics {
  metaobjects(
    type: "yotpo_review_statistics"
    first: 1
    query: "_global_all_reviews"
  ) {
    edges {
      node {
        fields {
          key
          value
        }
      }
    }
  }
}
```

## Project Structure

```
src/
├── clients/
│   ├── shopify-client-v2.js      # Shopify GraphQL client
│   └── yotpo-client.js            # Yotpo API client
├── transformers/
│   ├── review-transformer-v2.js   # Convert Yotpo → Shopify format
│   └── statistics-calculator.js   # Aggregate review stats
├── utils/
│   ├── html-decoder.js            # Decode HTML entities
│   ├── product-mapper.js          # Map reviews to products
│   └── sync-cache.js              # Cache for incremental syncs
├── setup-metaobject-definition-v2.js
├── setup-statistics-definition.js
├── sync.js                        # Main sync script
└── sync-statistics.js             # Statistics-only sync
```

## Rate Limiting

The script includes automatic rate limiting to stay within API limits:
- Pauses every 50 requests
- Yotpo: 5,000 requests/minute
- Shopify: Standard Admin API limits apply

## Troubleshooting

**Authentication errors:**
- Verify your API credentials in `.env`
- Check that your Yotpo App Key and Secret are correct

**Shopify API errors:**
- Confirm your access token is valid
- Verify your app has the required scopes (including `read_products` for SKU mapping)
- Check your shop URL format (`yourstore.myshopify.com`)
- If you get "Access denied for products field", add the `read_products` scope to your app

**Metaobject definition errors:**
- If definitions already exist, skip setup and run `npm run sync` directly

**Rate limit errors:**
- Wait a few minutes and retry
- The script includes built-in rate limiting, but very large syncs may need multiple runs

## Scheduling

To keep reviews in sync, schedule the sync command:

```bash
# Example cron: daily at 2 AM
0 2 * * * cd /path/to/project && npm run sync
```
