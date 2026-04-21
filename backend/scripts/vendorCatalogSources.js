/**
 * Top Adobe Commerce / Magento 2 extension vendors and listing entry points.
 * Selectors are best-effort; sites change — tune per vendor if harvest underfills.
 */
export const TOP_EXTENSION_VENDORS = [
  {
    id: 'amasty',
    name: 'Amasty',
    website: 'https://amasty.com',
    listingUrls: ['https://amasty.com/magento-2-extensions.html'],
    linkSelector: 'a[href*="amasty.com"][href$=".html"]',
    hostname: 'amasty.com',
  },
  {
    id: 'mageplaza',
    name: 'Mageplaza',
    website: 'https://www.mageplaza.com',
    listingUrls: ['https://www.mageplaza.com/magento-2-extensions/'],
    linkSelector: 'a[href*="mageplaza.com"][href$=".html"]',
    hostname: 'www.mageplaza.com',
  },
  {
    id: 'mirasvit',
    name: 'Mirasvit',
    website: 'https://mirasvit.com',
    listingUrls: ['https://mirasvit.com/magento-2-extensions.html'],
    linkSelector: 'a[href*="mirasvit.com"][href$=".html"]',
    hostname: 'mirasvit.com',
  },
  {
    id: 'aheadworks',
    name: 'Aheadworks',
    website: 'https://aheadworks.com',
    listingUrls: ['https://aheadworks.com/magento-2-extensions'],
    linkSelector: 'a[href*="aheadworks.com"]',
    hostname: 'aheadworks.com',
  },
  {
    id: 'bsscommerce',
    name: 'BSS Commerce',
    website: 'https://bsscommerce.com',
    listingUrls: ['https://bsscommerce.com/magento-2-extensions.html'],
    linkSelector: 'a[href*="bsscommerce.com"][href*=".html"]',
    hostname: 'bsscommerce.com',
  },
  {
    id: 'swissup',
    name: 'Swissuplabs',
    website: 'https://swissuplabs.com',
    listingUrls: ['https://swissuplabs.com/extensions.html'],
    linkSelector: 'a[href*="swissuplabs.com"]',
    hostname: 'swissuplabs.com',
  },
  {
    id: 'wyomind',
    name: 'Wyomind',
    website: 'https://www.wyomind.com',
    listingUrls: ['https://www.wyomind.com/magento2-extensions.html'],
    linkSelector: 'a[href*="wyomind.com"]',
    hostname: 'www.wyomind.com',
  },
  {
    id: 'mageworx',
    name: 'Mageworx',
    website: 'https://www.mageworx.com',
    listingUrls: ['https://www.mageworx.com/magento2-extensions.html'],
    linkSelector: 'a[href*="mageworx.com"]',
    hostname: 'www.mageworx.com',
  },
  {
    id: 'webkul',
    name: 'Webkul',
    website: 'https://store.webkul.com',
    listingUrls: ['https://store.webkul.com/Magento-2.html'],
    linkSelector: 'a[href*="store.webkul.com"]',
    hostname: 'store.webkul.com',
  },
  {
    id: 'landofcoder',
    name: 'Landofcoder',
    website: 'https://landofcoder.com',
    listingUrls: ['https://landofcoder.com/magento-2-extensions.html'],
    linkSelector: 'a[href*="landofcoder.com"]',
    hostname: 'landofcoder.com',
  },
  {
    id: 'ubertheme',
    name: 'Ubertheme',
    website: 'https://www.ubertheme.com',
    listingUrls: ['https://www.ubertheme.com/magento-extensions.html'],
    linkSelector: 'a[href*="ubertheme.com"]',
    hostname: 'www.ubertheme.com',
  },
  {
    id: 'magedelight',
    name: 'MageDelight',
    website: 'https://www.magedelight.com',
    listingUrls: ['https://www.magedelight.com/magento-extensions.html'],
    linkSelector: 'a[href*="magedelight.com"]',
    hostname: 'www.magedelight.com',
  },
  {
    id: 'magefan',
    name: 'Magefan',
    website: 'https://magefan.com',
    listingUrls: ['https://magefan.com/magento-2-extensions', 'https://magefan.com/magento-2-extensions/'],
    linkSelector: 'a[href*="magefan.com"]',
    hostname: 'magefan.com',
  },
  {
    id: 'firebear',
    name: 'Firebear Studio',
    website: 'https://firebearstudio.com',
    listingUrls: ['https://firebearstudio.com/'],
    linkSelector: 'a[href*="firebearstudio.com"]',
    hostname: 'firebearstudio.com',
  },
  {
    id: 'anowave',
    name: 'Anowave',
    website: 'https://www.anowave.com',
    listingUrls: ['https://www.anowave.com/magento-2-extensions.html'],
    linkSelector: 'a[href*="anowave.com"]',
    hostname: 'www.anowave.com',
  },
]

/** Browser-like headers — some storefronts return 403 for non-browser or bot-looking agents. */
export const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
}
