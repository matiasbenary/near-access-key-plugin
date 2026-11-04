import { Cards } from '@/components/cards';

import { useEffect, useState } from 'react';
import styles from '@/styles/app.module.css';

import { HelloNearContract } from '../../config';

import { useNearWallet } from '@/providers/near-provider';

export default function HelloNear() {
  const { signedAccountId, viewFunction, callFunction } = useNearWallet();
  const [greeting, setGreeting] = useState<string>('loading...');
  const [newGreeting, setNewGreeting] = useState('');
  const loggedIn = Boolean(signedAccountId);
  const [showSpinner, setShowSpinner] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    viewFunction({ contractId: HelloNearContract, method: 'get_greeting' })
      .then((greeting) => setGreeting(greeting as string))
      .catch((error: unknown) => setError(String(error)));
  }, [viewFunction]);


  const saveGreeting = async () => {
    setError('');
    setShowSpinner(true);
    try {
      await callFunction({ contractId: HelloNearContract, method: 'set_greeting', args: { greeting: newGreeting } });
      const greeting = await viewFunction({ contractId: HelloNearContract, method: 'get_greeting' });
      setGreeting(greeting as string);
    } catch (error) {
      setError(String(error));
    } finally {
      setShowSpinner(false);
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.description}>
        <p>
          Interacting with the contract: &nbsp;
          <code className={styles.code}>{HelloNearContract}</code>
        </p>
      </div>

      <div className={styles.center}>
        {error && <p role="alert" className="text-danger w-100">{error}</p>}
        <h1 className="w-100">
          The contract says: <code>{greeting}</code>
        </h1>
        <div className="input-group" hidden={!loggedIn}>
          <input
            type="text"
            className="form-control w-20"
            placeholder="Store a new greeting"
            onChange={(t) => setNewGreeting(t.target.value)}
          />
          <div className="input-group-append">
            <button className="btn btn-secondary" onClick={saveGreeting} disabled={showSpinner}>
              <span hidden={showSpinner}> Save </span>
              <i className="spinner-border spinner-border-sm" hidden={!showSpinner}></i>
            </button>
          </div>
        </div>
        <div className="w-100 text-end align-text-center" hidden={loggedIn}>
          <p className="m-0"> Please login to change the greeting </p>
        </div>
      </div>
      <Cards />
    </main>
  );
}
