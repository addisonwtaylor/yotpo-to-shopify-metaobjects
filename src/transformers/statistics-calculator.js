export function calculateReviewStatistics(reviews) {
  if (!reviews || reviews.length === 0) {
    return {};
  }

  // Group reviews by product SKU
  const statsByProduct = {};

  reviews.forEach(review => {
    const sku = review.sku || 'unknown';

    if (!statsByProduct[sku]) {
      statsByProduct[sku] = {
        productSku: sku,
        ratings: [],
        starCounts: {
          5: 0,
          4: 0,
          3: 0,
          2: 0,
          1: 0
        }
      };
    }

    const rating = review.score || 0;
    statsByProduct[sku].ratings.push(rating);

    if (rating >= 1 && rating <= 5) {
      statsByProduct[sku].starCounts[rating]++;
    }
  });

  // Calculate statistics for each product
  const productStatistics = {};

  Object.keys(statsByProduct).forEach(sku => {
    const data = statsByProduct[sku];
    const totalReviews = data.ratings.length;
    const sumRatings = data.ratings.reduce((sum, rating) => sum + rating, 0);
    const averageRating = totalReviews > 0 ? (sumRatings / totalReviews).toFixed(2) : '0.00';

    productStatistics[sku] = {
      productSku: sku,
      averageRating: parseFloat(averageRating),
      totalReviews,
      fiveStarCount: data.starCounts[5],
      fourStarCount: data.starCounts[4],
      threeStarCount: data.starCounts[3],
      twoStarCount: data.starCounts[2],
      oneStarCount: data.starCounts[1],
      lastUpdated: new Date().toISOString()
    };
  });

  return productStatistics;
}

export function calculateGlobalStatistics(reviews) {
  if (!reviews || reviews.length === 0) {
    return {
      productSku: '_global_all_reviews',
      averageRating: 0,
      totalReviews: 0,
      fiveStarCount: 0,
      fourStarCount: 0,
      threeStarCount: 0,
      twoStarCount: 0,
      oneStarCount: 0,
      lastUpdated: new Date().toISOString()
    };
  }

  const starCounts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  let totalRating = 0;

  reviews.forEach(review => {
    const rating = review.score || 0;
    totalRating += rating;

    if (rating >= 1 && rating <= 5) {
      starCounts[rating]++;
    }
  });

  const totalReviews = reviews.length;
  const averageRating = totalReviews > 0 ? parseFloat((totalRating / totalReviews).toFixed(2)) : 0;

  return {
    productSku: '_global_all_reviews',
    averageRating,
    totalReviews,
    fiveStarCount: starCounts[5],
    fourStarCount: starCounts[4],
    threeStarCount: starCounts[3],
    twoStarCount: starCounts[2],
    oneStarCount: starCounts[1],
    lastUpdated: new Date().toISOString()
  };
}

export function transformStatisticsToMetaobject(statistics) {
  return [
    {
      key: 'product_sku',
      value: statistics.productSku,
    },
    {
      key: 'average_rating',
      value: statistics.averageRating.toString(),
    },
    {
      key: 'total_reviews',
      value: statistics.totalReviews.toString(),
    },
    {
      key: 'five_star_count',
      value: statistics.fiveStarCount.toString(),
    },
    {
      key: 'four_star_count',
      value: statistics.fourStarCount.toString(),
    },
    {
      key: 'three_star_count',
      value: statistics.threeStarCount.toString(),
    },
    {
      key: 'two_star_count',
      value: statistics.twoStarCount.toString(),
    },
    {
      key: 'one_star_count',
      value: statistics.oneStarCount.toString(),
    },
    {
      key: 'synced_at',
      value: statistics.lastUpdated,
    },
  ];
}
