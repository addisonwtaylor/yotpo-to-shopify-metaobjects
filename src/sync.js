import 'dotenv/config';
import { YotpoClient } from './clients/yotpo-client.js';
import { ShopifyClient } from './clients/shopify-client.js';
import { ProductMapper } from './utils/product-mapper.js';
import { SyncCache } from './utils/sync-cache.js';
import { transformYotpoReview, shouldSyncReview } from './transformers/review-transformer.js';
import { calculateReviewStatistics, calculateGlobalStatistics, transformStatisticsToMetaobject } from './transformers/statistics-calculator.js';

async function syncReviews() {
  console.log('Starting Yotpo → Shopify Review Sync');
  console.log('='.repeat(70) + '\n');

  // Initialize clients
  const yotpoClient = new YotpoClient(
    process.env.YOTPO_APP_KEY,
    process.env.YOTPO_USER_TOKEN || process.env.YOTPO_APP_SECRET,
    !!process.env.YOTPO_USER_TOKEN
  );

  const shopifyClient = new ShopifyClient(
    process.env.SHOPIFY_SHOP_URL,
    process.env.SHOPIFY_ACCESS_TOKEN,
    process.env.SHOPIFY_API_VERSION || '2025-07'
  );

  const productMapper = new ProductMapper(shopifyClient);
  const syncCache = new SyncCache();

  // Stats tracking
  const stats = {
    total: 0,
    filtered: 0,
    cached: 0,
    productReviews: {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    },
    brandReviews: {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    },
    skuMatches: {
      matched: 0,
      notFound: 0,
    },
  };

  try {
    // Step 1: Fetch all reviews from Yotpo
    console.log('📥 Step 1: Fetching reviews from Yotpo...');
    const allReviews = await yotpoClient.fetchAllReviewsPaginated();
    stats.total = allReviews.length;
    console.log(`✓ Fetched ${stats.total} reviews\n`);

    // Step 2: Filter active reviews only
    console.log('🔍 Step 2: Filtering active reviews...');
    const activeReviews = allReviews.filter(shouldSyncReview);
    stats.filtered = allReviews.length - activeReviews.length;
    console.log(`✓ ${activeReviews.length} active reviews (filtered ${stats.filtered} inactive)\n`);

    if (activeReviews.length === 0) {
      console.log('No active reviews to sync. Exiting.');
      return;
    }

    // Step 2.5: Check cache to find changed/new reviews
    console.log('💾 Step 2.5: Checking cache for changes...');
    const reviewsToSync = activeReviews.filter(review => syncCache.needsSync(review));
    stats.cached = activeReviews.length - reviewsToSync.length;
    console.log(`✓ ${reviewsToSync.length} reviews need syncing (${stats.cached} unchanged)\n`);

    if (reviewsToSync.length === 0) {
      console.log('✨ All reviews are up to date! No sync needed.');
      syncCache.updateLastSyncTime();
      syncCache.saveCache();
      return;
    }

    // Step 3: Build product SKU cache
    console.log('📦 Step 3: Building product SKU → Product ID cache...');
    await productMapper.buildProductCache();
    const cacheStats = productMapper.getCacheStats();
    console.log(`✓ Ready to map reviews to products\n`);

    // Step 3.5: Build metaobject cache for fast lookups
    console.log('💾 Step 3.5: Building metaobject cache...');
    await shopifyClient.buildMetaobjectCache('yotpo_product_review');
    await shopifyClient.buildMetaobjectCache('yotpo_brand_review');
    console.log(`✓ Metaobject cache ready\n`);

    // Step 4: Separate reviews by type
    console.log('📊 Step 4: Categorizing reviews...');
    const productReviews = reviewsToSync.filter(r => r.sku !== 'yotpo_site_reviews');
    const brandReviews = reviewsToSync.filter(r => r.sku === 'yotpo_site_reviews');
    console.log(`✓ Product reviews: ${productReviews.length}`);
    console.log(`✓ Brand reviews: ${brandReviews.length}\n`);

    // Step 5: Sync product reviews
    if (productReviews.length > 0) {
      console.log('='.repeat(70));
      console.log('🛍️  Step 5a: Syncing Product Reviews');
      console.log('='.repeat(70) + '\n');

      for (let i = 0; i < productReviews.length; i++) {
        const review = productReviews[i];
        const progress = `[${i + 1}/${productReviews.length}]`;

        try {
          // Lookup Shopify product by SKU
          const productId = productMapper.getProductIdBySku(review.sku);

          if (!productId) {
            console.log(`${progress} ⚠️  SKU not found: ${review.sku} (Review #${review.id}) - skipping`);
            stats.productReviews.skipped++;
            stats.skuMatches.notFound++;
            continue;
          }

          stats.skuMatches.matched++;

          // Transform review data
          const { fields } = transformYotpoReview(review, productId);

          // Upsert metaobject
          const { result, operation } = await shopifyClient.upsertMetaobject(
            'yotpo_product_review',
            review.id,
            fields
          );

          if (result.userErrors && result.userErrors.length > 0) {
            console.log(`${progress} ❌ Error: Review #${review.id}`);
            result.userErrors.forEach(err => {
              console.log(`     ${err.message}`);
            });
            stats.productReviews.errors++;
          } else {
            const emoji = operation === 'created' ? '✓' : '↻';
            console.log(`${progress} ${emoji} ${operation.charAt(0).toUpperCase() + operation.slice(1)}: Review #${review.id} (${review.score}⭐) - SKU: ${review.sku}`);
            stats.productReviews[operation]++;

            // Mark as synced in cache
            syncCache.markSynced(review);
          }

          // Rate limiting: pause every 50 requests
          if ((i + 1) % 50 === 0) {
            console.log(`\n⏳ Pausing for rate limiting (processed ${i + 1}/${productReviews.length})...\n`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (error) {
          console.log(`${progress} ❌ Exception: Review #${review.id} - ${error.message}`);
          stats.productReviews.errors++;
        }
      }
    }

    // Step 6: Sync brand reviews
    if (brandReviews.length > 0) {
      console.log('\n' + '='.repeat(70));
      console.log('🏢 Step 5b: Syncing Brand Reviews');
      console.log('='.repeat(70) + '\n');

      for (let i = 0; i < brandReviews.length; i++) {
        const review = brandReviews[i];
        const progress = `[${i + 1}/${brandReviews.length}]`;

        try {
          // Transform review data (no product ID for brand reviews)
          const { fields } = transformYotpoReview(review);

          // Upsert metaobject
          const { result, operation } = await shopifyClient.upsertMetaobject(
            'yotpo_brand_review',
            review.id,
            fields
          );

          if (result.userErrors && result.userErrors.length > 0) {
            console.log(`${progress} ❌ Error: Review #${review.id}`);
            result.userErrors.forEach(err => {
              console.log(`     ${err.message}`);
            });
            stats.brandReviews.errors++;
          } else {
            const emoji = operation === 'created' ? '✓' : '↻';
            console.log(`${progress} ${emoji} ${operation.charAt(0).toUpperCase() + operation.slice(1)}: Review #${review.id} (${review.score}⭐) - Brand review`);
            stats.brandReviews[operation]++;

            // Mark as synced in cache
            syncCache.markSynced(review);
          }

          // Rate limiting: pause every 50 requests
          if ((i + 1) % 50 === 0) {
            console.log(`\n⏳ Pausing for rate limiting (processed ${i + 1}/${brandReviews.length})...\n`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (error) {
          console.log(`${progress} ❌ Exception: Review #${review.id} - ${error.message}`);
          stats.brandReviews.errors++;
        }
      }
    }

    // Final Summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 SYNC COMPLETE');
    console.log('='.repeat(70));

    console.log('\n📥 Yotpo Reviews:');
    console.log(`  Total fetched: ${stats.total}`);
    console.log(`  Active: ${activeReviews.length}`);
    console.log(`  Filtered out: ${stats.filtered}`);
    console.log(`  💾 Cached (unchanged): ${stats.cached}`);

    console.log('\n🛍️  Product Reviews:');
    console.log(`  ✓ Created: ${stats.productReviews.created}`);
    console.log(`  ↻ Updated: ${stats.productReviews.updated}`);
    console.log(`  ⊘ Skipped: ${stats.productReviews.skipped}`);
    console.log(`  ✗ Errors: ${stats.productReviews.errors}`);

    console.log('\n🏢 Brand Reviews:');
    console.log(`  ✓ Created: ${stats.brandReviews.created}`);
    console.log(`  ↻ Updated: ${stats.brandReviews.updated}`);
    console.log(`  ⊘ Skipped: ${stats.brandReviews.skipped}`);
    console.log(`  ✗ Errors: ${stats.brandReviews.errors}`);

    console.log('\n🔗 SKU Matching:');
    console.log(`  ✓ Matched: ${stats.skuMatches.matched}`);
    console.log(`  ✗ Not found: ${stats.skuMatches.notFound}`);

    const totalCreated = stats.productReviews.created + stats.brandReviews.created;
    const totalUpdated = stats.productReviews.updated + stats.brandReviews.updated;
    const totalSkipped = stats.productReviews.skipped + stats.brandReviews.skipped;
    const totalErrors = stats.productReviews.errors + stats.brandReviews.errors;

    console.log('\n📈 Overall:');
    console.log(`  ✓ Created: ${totalCreated}`);
    console.log(`  ↻ Updated: ${totalUpdated}`);
    console.log(`  ⊘ Skipped: ${totalSkipped}`);
    console.log(`  ✗ Errors: ${totalErrors}`);

    console.log('\n' + '='.repeat(70));

    if (stats.skuMatches.notFound > 0) {
      console.log('\n⚠️  Warning: Some reviews were skipped due to SKU mismatches.');
      console.log('   Check that Yotpo SKUs match Shopify product variant SKUs.');
    }

    if (totalErrors > 0) {
      console.log('\n⚠️  Warning: Some reviews failed to sync. Review errors above.');
    }

    // Save cache
    syncCache.updateLastSyncTime();
    syncCache.saveCache();

    console.log('\n✅ Review sync completed successfully!\n');

    // Step 7: Sync aggregated statistics
    console.log('='.repeat(70));
    console.log('📊 Step 6: Syncing Aggregated Statistics');
    console.log('='.repeat(70) + '\n');

    await syncStatistics(activeReviews, shopifyClient);

    console.log('\n✅ Full sync completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Sync failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

async function syncStatistics(reviews, shopifyClient) {
  const statsClient = new ShopifyClient(
    process.env.SHOPIFY_SHOP_URL,
    process.env.SHOPIFY_ACCESS_TOKEN,
    process.env.SHOPIFY_API_VERSION || '2025-07'
  );

  let statsCreated = 0;
  let statsUpdated = 0;
  let statsErrors = 0;

  try {
    // Calculate per-product statistics
    const productStatistics = calculateReviewStatistics(reviews);
    const productSkus = Object.keys(productStatistics);

    console.log(`📊 Calculated statistics for ${productSkus.length} products`);

    // Sync per-product statistics
    for (let i = 0; i < productSkus.length; i++) {
      const sku = productSkus[i];
      const stats = productStatistics[sku];
      const progress = `[${i + 1}/${productSkus.length}]`;

      try {
        const existingMetaobject = await statsClient.getStatisticsMetaobjectBySku(sku);
        const metaobjectFields = transformStatisticsToMetaobject(stats);

        if (existingMetaobject) {
          const result = await statsClient.updateStatisticsMetaobject(
            existingMetaobject.id,
            metaobjectFields
          );

          if (result.userErrors && result.userErrors.length > 0) {
            console.log(`${progress} ❌ Error updating stats for SKU ${sku}:`);
            result.userErrors.forEach(err => console.log(`     ${err.message} (${err.code || 'N/A'})`));
            statsErrors++;
          } else {
            console.log(`${progress} ↻ Updated stats: ${sku} (${stats.totalReviews} reviews, ${stats.averageRating}⭐)`);
            statsUpdated++;
          }
        } else {
          const result = await statsClient.createStatisticsMetaobject(metaobjectFields);

          if (result.userErrors && result.userErrors.length > 0) {
            console.log(`${progress} ❌ Error creating stats for SKU ${sku}:`);
            result.userErrors.forEach(err => console.log(`     ${err.message} (${err.code || 'N/A'})`));
            statsErrors++;
          } else {
            console.log(`${progress} ✓ Created stats: ${sku} (${stats.totalReviews} reviews, ${stats.averageRating}⭐)`);
            statsCreated++;
          }
        }
      } catch (error) {
        console.log(`${progress} ❌ Exception for SKU ${sku}: ${error.message}`);
        statsErrors++;
      }
    }

    // Calculate and sync global statistics (all reviews combined)
    console.log('\n📊 Calculating global statistics (all reviews)...');
    const globalStats = calculateGlobalStatistics(reviews);

    try {
      const existingGlobal = await statsClient.getStatisticsMetaobjectBySku('_global_all_reviews');
      const globalFields = transformStatisticsToMetaobject(globalStats);

      if (existingGlobal) {
        const result = await statsClient.updateStatisticsMetaobject(
          existingGlobal.id,
          globalFields
        );

        if (result.userErrors && result.userErrors.length > 0) {
          console.log('❌ Error updating global statistics:');
          result.userErrors.forEach(err => console.log(`     ${err.message} (${err.code || 'N/A'})`));
          statsErrors++;
        } else {
          console.log(`✓ Updated global stats: ${globalStats.totalReviews} total reviews, ${globalStats.averageRating}⭐ average`);
          statsUpdated++;
        }
      } else {
        const result = await statsClient.createStatisticsMetaobject(globalFields);

        if (result.userErrors && result.userErrors.length > 0) {
          console.log('❌ Error creating global statistics:');
          result.userErrors.forEach(err => console.log(`     ${err.message} (${err.code || 'N/A'})`));
          statsErrors++;
        } else {
          console.log(`✓ Created global stats: ${globalStats.totalReviews} total reviews, ${globalStats.averageRating}⭐ average`);
          statsCreated++;
        }
      }
    } catch (error) {
      console.log(`❌ Exception syncing global stats: ${error.message}`);
      statsErrors++;
    }

    // Statistics summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 STATISTICS SYNC COMPLETE');
    console.log('='.repeat(70));
    console.log(`  ✓ Created: ${statsCreated}`);
    console.log(`  ↻ Updated: ${statsUpdated}`);
    console.log(`  ✗ Errors: ${statsErrors}`);
    console.log(`  📊 Total: ${productSkus.length + 1} (${productSkus.length} products + 1 global)`);
    console.log('='.repeat(70));

  } catch (error) {
    console.error('❌ Statistics sync failed:', error.message);
  }
}

// Run the sync
syncReviews();
