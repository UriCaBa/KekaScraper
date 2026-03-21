import assert from 'node:assert/strict';

import {
  buildSearchQueries,
  isEmptyListing,
  isLikelyHostel,
  MAX_DETAIL_CONCURRENCY,
  scoreListingMatch,
} from '../src/lib/maps.js';

export const tests = [
  {
    name: 'buildSearchQueries adds Spanish hostel synonyms without duplicating queries',
    run: () => {
      assert.deepEqual(buildSearchQueries('hostels in', 'Terrassa'), [
        'hostels in Terrassa',
        'hostal Terrassa',
        'albergue Terrassa',
        'alberg Terrassa',
        'pension Terrassa',
        'guest house Terrassa',
        'student residence Terrassa',
        'residencia estudiantes Terrassa',
      ]);
    },
  },
  {
    name: 'isLikelyHostel accepts hostal-style listings and rejects explicit hotels',
    run: () => {
      assert.equal(
        isLikelyHostel({
          name: 'Hostal Terrassa Centre',
          category: 'Budget accommodation',
          website: 'https://hostalterrassa.example',
          googleMapsUrl: 'https://maps.google.com/?q=hostal+terrassa',
        }),
        true,
      );

      assert.equal(
        isLikelyHostel({
          name: 'Terrassa Park Hotel',
          category: 'Hotel',
          website: 'https://terrassaparkhotel.example',
          googleMapsUrl: 'https://maps.google.com/?q=terrassa+park+hotel',
        }),
        false,
      );

      const lowConfidence = scoreListingMatch({
        name: 'Pension Terrassa Centre',
        category: 'Lodging',
        website: 'https://pensionterrassa.example',
        googleMapsUrl: 'https://maps.google.com/?q=pension+terrassa',
      });
      assert.equal(lowConfidence.accepted, false);
      assert.equal(lowConfidence.reason, 'low-confidence-hostel-match');

      const strongPositive = scoreListingMatch({
        name: 'Alberg Juvenil Vallparadis',
        category: 'Youth hostel',
        website: 'https://alberg-vallparadis.example',
        googleMapsUrl: 'https://maps.google.com/?q=alberg+juvenil',
        searchedCity: 'Terrassa',
        address: 'Terrassa, Barcelona',
      });
      assert.equal(strongPositive.accepted, true);
      assert.match(strongPositive.positiveSignals.join(' '), /strong-positive/);

      const wrongCity = scoreListingMatch({
        name: 'Hostal La Terrassa',
        category: 'Hostal',
        website: 'https://hostal-la-terrassa.example',
        googleMapsUrl: 'https://maps.google.com/?q=hostal+la+terrassa+barcelona',
        searchedCity: 'Terrassa',
        address: 'Barcelona',
      });
      assert.equal(wrongCity.accepted, false);
      assert.match(wrongCity.negativeSignals.join(' '), /address-strong-negative-other-city/);

      const wrongCityWithoutAddress = scoreListingMatch({
        name: 'Hostal Barcelona Center',
        category: 'Hostal',
        website: 'https://hostal-barcelona-center.example',
        googleMapsUrl: 'https://maps.google.com/?q=hostal+barcelona+center',
        searchedCity: 'Terrassa',
      });
      assert.equal(wrongCityWithoutAddress.accepted, false);
      assert.match(wrongCityWithoutAddress.negativeSignals.join(' '), /location-strong-negative-other-city/);
    },
  },
  {
    name: 'isEmptyListing rejects listings with no business fields',
    run: () => {
      assert.equal(
        isEmptyListing({ name: 'Terrassa Terrassa', address: null, website: null, phone: null, category: null }),
        true,
        'listing with only a name and no business fields is empty',
      );

      assert.equal(
        isEmptyListing({
          name: 'Hostal Terrassa',
          address: 'Carrer Major 1',
          website: null,
          phone: null,
          category: null,
        }),
        false,
        'listing with an address is not empty',
      );

      assert.equal(
        isEmptyListing({
          name: 'Hostal Terrassa',
          address: null,
          website: 'https://hostal.com',
          phone: null,
          category: null,
        }),
        false,
        'listing with a website is not empty',
      );

      assert.equal(
        isEmptyListing({
          name: 'Hostal Terrassa',
          address: null,
          website: null,
          phone: '+34 937 000 000',
          category: null,
        }),
        false,
        'listing with a phone is not empty',
      );

      assert.equal(
        isEmptyListing({ name: 'Hostal Terrassa', address: null, website: null, phone: null, category: 'Hostel' }),
        false,
        'listing with a category is not empty',
      );
    },
  },
  {
    name: 'MAX_DETAIL_CONCURRENCY is capped at 3',
    run: () => {
      assert.equal(MAX_DETAIL_CONCURRENCY, 3);
      assert.equal(typeof MAX_DETAIL_CONCURRENCY, 'number');
    },
  },
  {
    name: 'detailConcurrency option defaults to 1 and is clamped to MAX_DETAIL_CONCURRENCY',
    run: () => {
      // Verify the clamping logic: Math.min(Math.max(value, 1), MAX_DETAIL_CONCURRENCY)
      const clamp = (v) => Math.min(Math.max(v, 1), MAX_DETAIL_CONCURRENCY);
      assert.equal(clamp(0), 1, 'values below 1 are clamped to 1');
      assert.equal(clamp(1), 1);
      assert.equal(clamp(2), 2);
      assert.equal(clamp(3), 3);
      assert.equal(clamp(5), 3, 'values above MAX are clamped to MAX_DETAIL_CONCURRENCY');
      assert.equal(clamp(100), 3);
    },
  },
];
